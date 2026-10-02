import { prisma } from "@repostinsight/db";

/**
 * Ekstrak URL thumbnail dari rawJson post (dipakai render_post_card).
 * Urutan kandidat sama seperti katalog repost (apps/web/app/api/reposts/route.ts).
 */
export function extractThumbnailUrl(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const obj = rawJson as Record<string, unknown>;

  if (typeof obj.thumbnail_url === "string") return obj.thumbnail_url;
  if (typeof obj.display_url === "string") return obj.display_url;

  const imageVersions = obj.image_versions2 as { candidates?: Array<{ url?: string }> } | undefined;
  if (imageVersions?.candidates?.[0]?.url) {
    return imageVersions.candidates[0].url;
  }

  const carouselMedia = obj.carousel_media as Array<{
    image_versions2?: { candidates?: Array<{ url?: string }> };
    display_url?: string;
  }> | undefined;

  if (carouselMedia?.[0]?.image_versions2?.candidates?.[0]?.url) {
    return carouselMedia[0].image_versions2.candidates[0].url;
  }
  if (carouselMedia?.[0]?.display_url) {
    return carouselMedia[0].display_url;
  }

  return null;
}

/**
 * Panggil LLM chat 9Router untuk analisis teks (dipakai analyze_high_performing_hooks).
 */
export async function callChatLLM(prompt: string): Promise<string> {
  const model = process.env.NINEROUTER_CHAT_MODEL || process.env.NINEROUTER_MODEL || "ag/gemini-3-flash";
  const baseUrl = (process.env.NINEROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
  const apiKey = process.env.NINEROUTER_API_KEY || "";
  const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`9Router Chat API Error [${res.status}]: ${errText}`);
  }

  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * Tool 1: Semantic Search via pgvector (FR-6.2)
 * Embeds user query and searches posts by cosine similarity
 */
export async function executeSemanticSearch(query: string, limit: number = 5) {
  const safeLimit = Math.max(1, Math.min(15, limit));

  // Over-fetch factor: ambil lebih banyak kandidat untuk di-rerank secara temporal
  const OVER_FETCH_FACTOR = 4;
  const SIMILARITY_WEIGHT = 0.55; // α — bobot kemiripan semantik
  const RECENCY_WEIGHT = 1 - SIMILARITY_WEIGHT; // (1-α) — bobot kebaruan data

  const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:0.6b";
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

  try {
    const embedRes = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: [query],
        options: {
          num_gpu: 0,
        },
      }),
    });

    if (!embedRes.ok) {
      throw new Error(`Embedding API error: ${embedRes.status}`);
    }

    const embedJson = await embedRes.json();
    const queryVector = embedJson.embeddings?.[0];
    if (!queryVector || !Array.isArray(queryVector)) {
      throw new Error("Gagal mengekstrak embedding dari Ollama");
    }

    const vectorStr = `[${queryVector.join(",")}]`;

    // 2. Rentang waktu GLOBAL seluruh database — basis kebaruan adalah KAPAN DATA DI-SCRAPE
    //    (repost_events.scraped_at), BUKAN tanggal asli post diunggah di IG (taken_at).
    const tsRange: any[] = await prisma.$queryRawUnsafe(
      `SELECT EXTRACT(EPOCH FROM MIN(re.scraped_at))::bigint AS min_ts,
              EXTRACT(EPOCH FROM MAX(re.scraped_at))::bigint AS max_ts
       FROM repost_events re
       JOIN posts p ON p.id = re.post_id
       WHERE p.embedding IS NOT NULL;`
    );
    const globalMinTs = Number(tsRange[0]?.min_ts ?? 0);
    const globalMaxTs = Number(tsRange[0]?.max_ts ?? 0);
    const globalTsRange = globalMaxTs - globalMinTs || 1;

    // 3. Over-fetch kandidat + join repost_events untuk konteks repost
    const candidateLimit = safeLimit * OVER_FETCH_FACTOR;
    const candidatePosts: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         p.id,
         p.owner_username,
         p.caption_text,
         p.hashtags,
         p.like_count,
         p.play_count,
         p.media_type,
         p.taken_at,
         p.visual_description,
         COUNT(re.id)::int AS repost_count,
         COUNT(DISTINCT re.follower_username)::int AS unique_reposter_count,
         MAX(re.scraped_at) AS last_scraped_at,
         (p.embedding <=> $1::vector) AS distance
       FROM posts p
       LEFT JOIN repost_events re ON re.post_id = p.id
       WHERE p.embedding IS NOT NULL
       GROUP BY p.id, p.owner_username, p.caption_text, p.hashtags,
                p.like_count, p.play_count, p.media_type, p.taken_at,
                p.visual_description, p.embedding
       ORDER BY distance ASC
       LIMIT $2;`,
      vectorStr,
      candidateLimit
    );

    if (candidatePosts.length === 0) {
      return { source: "pgvector_semantic_search", results: [] };
    }

    // 4. Re-rank dengan global-normalized recency — basis: kapan data di-scrape, bukan taken_at
    const reranked = candidatePosts.map((p) => {
      const similarity = Math.max(0, 1 - (p.distance ?? 1));
      const ts = p.last_scraped_at
        ? Math.floor(new Date(p.last_scraped_at).getTime() / 1000)
        : globalMinTs;
      const recencyScore = (ts - globalMinTs) / globalTsRange;
      const combinedScore = SIMILARITY_WEIGHT * similarity + RECENCY_WEIGHT * recencyScore;
      return { ...p, similarity, recencyScore, combinedScore };
    });

    reranked.sort((a, b) => b.combinedScore - a.combinedScore);
    const topPosts = reranked.slice(0, safeLimit);

    // Ambil thumbnail untuk render_post_card (rawJson tidak ikut di GROUP BY di atas)
    const thumbRows: Array<{ id: string; raw_json: unknown }> =
      topPosts.length > 0
        ? await prisma.$queryRawUnsafe(
            `SELECT id, raw_json FROM posts WHERE id = ANY($1::text[])`,
            topPosts.map((p) => p.id)
          )
        : [];
    const thumbMap = new Map(thumbRows.map((r) => [r.id, extractThumbnailUrl(r.raw_json)]));

    return {
      source: "pgvector_semantic_search_reranked",
      queryNote: `Diurutkan: relevansi ${(SIMILARITY_WEIGHT * 100).toFixed(0)}% + kebaruan ${(RECENCY_WEIGHT * 100).toFixed(0)}%. repostCount = jumlah followers @ynsurabaya yang me-repost.`,
      results: topPosts.map((p) => ({
        id: p.id,
        ownerUsername: p.owner_username,
        captionText: p.caption_text,
        hashtags: p.hashtags,
        mediaType: p.media_type,
        likeCount: p.like_count,
        playCount: p.play_count,
        takenAt: p.taken_at ? new Date(p.taken_at).toISOString().split("T")[0] : null,
        visualDescription: p.visual_description ?? null,
        thumbnailUrl: thumbMap.get(p.id) ?? null,
        repostCount: Number(p.repost_count),
        uniqueReposters: Number(p.unique_reposter_count),
        similarity: parseFloat(p.similarity.toFixed(3)),
        recencyScore: parseFloat(p.recencyScore.toFixed(3)),
        combinedScore: parseFloat(p.combinedScore.toFixed(3)),
      })),
    };
  } catch (err) {
    console.warn("Semantic search falling back to text search due to error:", err);
    const fallbackPosts = await prisma.post.findMany({
      where: { captionText: { contains: query, mode: "insensitive" } },
      take: safeLimit,
      select: {
        id: true,
        ownerUsername: true,
        captionText: true,
        hashtags: true,
        likeCount: true,
        visualDescription: true,
        repostEvents: { select: { followerUsername: true } },
      },
    });
    return {
      source: "keyword_fallback",
      results: fallbackPosts.map((p) => ({
        id: p.id,
        ownerUsername: p.ownerUsername,
        captionText: p.captionText,
        hashtags: p.hashtags,
        likeCount: p.likeCount,
        visualDescription: p.visualDescription,
        repostCount: p.repostEvents.length,
        uniqueReposters: new Set(p.repostEvents.map((r) => r.followerUsername)).size,
      })),
    };
  }
}

/**
 * Tool 2: Query Aggregate from Materialized Views (FR-6.3)
 */
export async function executeQueryAggregate(
  metric: "top_accounts" | "trending_hashtags" | "activity_timeline" | "summary",
  limit: number = 10
) {
  const safeLimit = Math.max(1, Math.min(30, limit));

  switch (metric) {
    case "top_accounts": {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT
           mv.owner_username,
           mv.repost_count,
           mv.unique_followers_count,
           mv.total_likes,
           mv.total_plays,
           MAX(p.taken_at)::date AS most_recent_post_date
         FROM mv_top_reposted_accounts mv
         JOIN posts p ON p.owner_username = mv.owner_username
         GROUP BY mv.owner_username, mv.repost_count, mv.unique_followers_count,
                  mv.total_likes, mv.total_plays
         ORDER BY mv.repost_count DESC
         LIMIT $1;`,
        safeLimit
      );
      return {
        metric: "top_accounts",
        data: rows.map((r) => ({
          ownerUsername: r.owner_username,
          repostCount: Number(r.repost_count),
          uniqueFollowers: Number(r.unique_followers_count),
          totalLikes: Number(r.total_likes),
          totalPlays: Number(r.total_plays),
          mostRecentPostDate: r.most_recent_post_date
            ? new Date(r.most_recent_post_date).toISOString().split("T")[0]
            : null,
        })),
      };
    }

    case "trending_hashtags": {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT tag, usage_count, unique_reposters_count
         FROM mv_trending_hashtags
         ORDER BY usage_count DESC
         LIMIT $1;`,
        safeLimit
      );
      const total = rows.reduce((s, r) => s + Number(r.usage_count), 0) || 1;
      return {
        metric: "trending_hashtags",
        data: rows.map((r) => ({
          hashtag: r.tag,
          count: Number(r.usage_count),
          uniqueReposters: Number(r.unique_reposters_count),
          percentage: parseFloat(((Number(r.usage_count) / total) * 100).toFixed(1)),
        })),
      };
    }

    case "activity_timeline": {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT activity_date, repost_count, active_followers_count
         FROM mv_repost_activity_timeline
         ORDER BY activity_date ASC
         LIMIT $1;`,
        safeLimit
      );
      return {
        metric: "activity_timeline",
        data: rows.map((r) => ({
          date: new Date(r.activity_date).toISOString().split("T")[0],
          repostCount: Number(r.repost_count),
          activeFollowers: Number(r.active_followers_count),
        })),
      };
    }

    case "summary":
    default: {
      const [statusCounts, totalPosts, totalReposts, postsWithEmbedding] =
        await Promise.all([
          prisma.follower.groupBy({ by: ["status"], _count: { _all: true } }),
          prisma.post.count(),
          prisma.repostEvent.count(),
          prisma.post.count({ where: { embeddingStatus: "done" } }),
        ]);

      const byStatus: Record<string, number> = {};
      let totalFollowers = 0;
      for (const row of statusCounts) {
        byStatus[row.status] = row._count._all;
        totalFollowers += row._count._all;
      }
      const doneFollowers = byStatus["done"] ?? 0;

      return {
        metric: "summary",
        data: {
          totalFollowers,
          followersByStatus: {
            done: doneFollowers,
            pending: byStatus["pending"] ?? 0,
            in_progress: byStatus["in_progress"] ?? 0,
            failed: byStatus["failed"] ?? 0,
          },
          scrapeProgressPct:
            totalFollowers > 0
              ? parseFloat(((doneFollowers / totalFollowers) * 100).toFixed(1))
              : 0,
          totalPosts,
          postsWithEmbedding,
          embeddingCoveragePct:
            totalPosts > 0
              ? parseFloat(((postsWithEmbedding / totalPosts) * 100).toFixed(1))
              : 0,
          totalReposts,
        },
      };
    }
  }
}

/**
 * Tool 3: Analyze Topics — distribusi topik nyata dari MV (FR-6.3)
 * - Menggunakan mv_trending_hashtags (akurat, seluruh DB)
 * - Persentase dihitung dari TOTAL GLOBAL, bukan hanya top-N
 * - Membawa uniquePostCount per hashtag
 */
export async function executeAnalyzeTopics(topN: number = 15) {
  const safeTopN = Math.max(1, Math.min(50, topN));

  // Ambil semua tag dari MV untuk hitung total global yang benar
  const allRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT tag, usage_count, unique_reposters_count
     FROM mv_trending_hashtags
     ORDER BY usage_count DESC;`
  );

  if (allRows.length === 0) {
    return { source: "database_hashtag_analysis", totalHashtagsFound: 0, topics: [] };
  }

  // Total dari SEMUA tag — membuat persentase akurat secara global
  const globalTotal = allRows.reduce((s, r) => s + Number(r.usage_count), 0) || 1;
  const topRows = allRows.slice(0, safeTopN);

  // Hitung uniquePostCount (berapa post berbeda punya hashtag ini)
  const topTags = topRows.map((r) => r.tag);
  const uniquePostCounts: Record<string, number> = {};
  if (topTags.length > 0) {
    const upRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT tag, COUNT(DISTINCT p.id)::int AS unique_post_count
       FROM posts p
       CROSS JOIN LATERAL unnest(p.hashtags) AS tag
       WHERE tag = ANY($1::text[])
       GROUP BY tag;`,
      topTags
    );
    for (const r of upRows) {
      uniquePostCounts[r.tag] = Number(r.unique_post_count);
    }
  }

  return {
    source: "database_hashtag_analysis",
    note: "percentageOfAll = proporsi dari total SEMUA hashtag di database. uniquePostCount = berapa postingan berbeda yang memakai hashtag ini.",
    totalHashtagsFound: allRows.length,
    globalTotalUsage: globalTotal,
    topics: topRows.map((r) => ({
      hashtag: r.tag,
      repostEventCount: Number(r.usage_count),
      uniquePostCount: uniquePostCounts[r.tag] ?? null,
      uniqueReposters: Number(r.unique_reposters_count),
      percentageOfAll: parseFloat(((Number(r.usage_count) / globalTotal) * 100).toFixed(2)),
    })),
  };
}

/**
 * Tool: Distribusi Topik (semantik, whole-database) — PROMPT-UPGRADE-CHATBOT.md item 7,
 * diperbarui PROMPT-CHATBOT-TOOLS-V2.md Task B: sumber langsung posts.topic_label
 * (mencakup post tanpa hashtag; tiap repost event dihitung tepat sekali).
 */
export async function executeGetTopicDistribution(topN: number = 10) {
  const safeTopN = Math.max(1, Math.min(30, topN));

  const allRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT topic_label, repost_event_count, unique_post_count, unique_reposters_count
     FROM mv_topic_distribution
     ORDER BY repost_event_count DESC;`
  );

  if (allRows.length === 0) {
    return {
      source: "mv_topic_distribution",
      note: "Belum ada topik terklasifikasi (worker belum selesai memproses backlog post).",
      totalTopicsFound: 0,
      topics: [],
    };
  }

  const globalTotal = allRows.reduce((s, r) => s + Number(r.repost_event_count), 0) || 1;
  const topRows = allRows.slice(0, safeTopN);

  // Cakupan: post yang topic_label-nya masih NULL tidak masuk MV.
  const [classifiedRows, totalRows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS classified
       FROM repost_events re JOIN posts p ON p.id = re.post_id
       WHERE p.topic_label IS NOT NULL;`
    ),
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS total FROM repost_events;`),
  ]);
  const classifiedRepostEvents = Number(classifiedRows[0]?.classified ?? 0);
  const totalRepostEvents = Number(totalRows[0]?.total ?? 0);
  const coveragePct =
    totalRepostEvents > 0
      ? parseFloat(((classifiedRepostEvents / totalRepostEvents) * 100).toFixed(1))
      : 0;

  return {
    source: "mv_topic_distribution",
    note: "Distribusi TOPIK (kelompok semantik beberapa hashtag terkait maupun hasil klasifikasi isi konten), dihitung dari SELURUH bagian database yang sudah terklasifikasi — bukan sampel. percentageOfAll = proporsi dari total SEMUA topik terklasifikasi. Topik 'Lainnya' berisi hashtag generik/algoritmik (fyp, viral, reels, dst). Topik 'Tidak terklasifikasi' berisi post yang genuinely tanpa informasi (caption kosong, belum ada deskripsi visual).",
    totalTopicsFound: allRows.length,
    globalTotalUsage: globalTotal,
    coveragePct,
    classifiedRepostEvents,
    totalRepostEvents,
    // Catatan cakupan hanya relevan kalau klasifikasi belum tuntas — sembunyikan jika >= 95%.
    coverageNote:
      coveragePct < 95
        ? `Analisis mencakup ${coveragePct.toFixed(1)}% (${classifiedRepostEvents} dari ${totalRepostEvents} repost events) data yang sudah terklasifikasi topiknya.`
        : undefined,
    topics: topRows.map((r) => ({
      topicLabel: r.topic_label,
      occurrenceCount: Number(r.repost_event_count),
      uniquePostCount: Number(r.unique_post_count),
      uniqueReposters: Number(r.unique_reposters_count),
      percentageOfAll: parseFloat(((Number(r.repost_event_count) / globalTotal) * 100).toFixed(2)),
    })),
  };
}

/**
 * Tool: Detail Satu Post — drill-down setelah semantic_search (PROMPT-UPGRADE-CHATBOT.md item 3)
 * commentSummary/topComments sengaja null/kosong: fitur rangkuman komentar (F11) belum
 * diimplementasikan di skema saat ini — tool tetap harus berjalan tanpa error.
 */
export async function executeGetPostDetail(postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      repostEvents: { select: { followerUsername: true } },
      comments: {
        orderBy: { likeCount: "desc" },
        take: 10,
        select: {
          id: true,
          text: true,
          likeCount: true,
          commenterUsername: true,
          commentedAt: true,
        },
      },
    },
  });

  if (!post) {
    return { found: false };
  }

  return {
    found: true,
    id: post.id,
    ownerUsername: post.ownerUsername,
    captionText: post.captionText,
    hashtags: post.hashtags,
    mediaType: post.mediaType,
    likeCount: post.likeCount,
    playCount: post.playCount,
    takenAt: post.takenAt ? post.takenAt.toISOString().split("T")[0] : null,
    visualDescription: post.visualDescription ?? null,
    thumbnailUrl: extractThumbnailUrl(post.rawJson),
    commentSummary: post.commentSummary ?? null,
    topComments:
      post.comments?.map((c) => ({
        text: c.text,
        likeCount: c.likeCount ?? 0,
        commenterUsername: c.commenterUsername,
      })) ?? [],
    repostedBy: post.repostEvents.slice(0, 50).map((r) => r.followerUsername),
    repostedByTruncated: post.repostEvents.length > 50,
    repostCount: post.repostEvents.length,
  };
}

/**
 * Tool A1: Klaster minat bersama — segmentasi follower berdasarkan topik yang
 * PALING SERING mereka repost (dominant interest). Konteks riset komunitas /
 * kolaborasi (programming event per-segmen minat), bukan analisis konten biasa.
 */
export async function executeGetSharedInterestClusters(minClusterSize: number = 3) {
  const safeMin = Math.max(1, Math.min(50, Math.floor(minClusterSize) || 3));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `WITH follower_topic_counts AS (
       SELECT re.follower_username, p.topic_label, COUNT(*)::int AS topic_count
       FROM repost_events re
       JOIN posts p ON p.id = re.post_id
       WHERE p.topic_label IS NOT NULL AND p.topic_label != 'Lainnya'
       GROUP BY re.follower_username, p.topic_label
     ),
     dominant_topic AS (
       SELECT DISTINCT ON (follower_username) follower_username, topic_label, topic_count
       FROM follower_topic_counts
       ORDER BY follower_username, topic_count DESC
     )
     SELECT topic_label, COUNT(*)::int AS cluster_size,
            array_agg(follower_username ORDER BY topic_count DESC) AS followers
     FROM dominant_topic
     GROUP BY topic_label
     HAVING COUNT(*) >= $1
     ORDER BY cluster_size DESC;`,
    safeMin
  );
  return {
    note: "Tiap follower dikelompokkan berdasarkan topik yang PALING SERING mereka repost",
    clusters: rows.map((r) => ({
      topic: r.topic_label,
      clusterSize: Number(r.cluster_size),
      sampleFollowers: (r.followers as string[]).slice(0, 20),
    })),
  };
}

/**
 * Tool A2: Kandidat kolaborasi — akun original dengan audiens overlap tinggi ke
 * followers suatu akun. Konteks riset komunitas/kolaborasi (co-host event),
 * bukan analisis konten biasa.
 */
export async function executeSuggestCollaborationCandidates(ownerUsername: string, limit: number = 10) {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit) || 10));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `WITH target_followers AS (
       SELECT DISTINCT re.follower_username
       FROM repost_events re JOIN posts p ON p.id = re.post_id
       WHERE p.owner_username = $1
     )
     SELECT p2.owner_username, COUNT(DISTINCT re2.follower_username)::int AS overlap_count
     FROM repost_events re2
     JOIN posts p2 ON p2.id = re2.post_id
     WHERE re2.follower_username IN (SELECT follower_username FROM target_followers)
       AND p2.owner_username != $1
     GROUP BY p2.owner_username
     ORDER BY overlap_count DESC LIMIT $2;`,
    ownerUsername, safeLimit
  );
  const totalRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(DISTINCT re.follower_username)::int AS total_target_followers
     FROM repost_events re JOIN posts p ON p.id = re.post_id WHERE p.owner_username = $1;`,
    ownerUsername
  );
  const totalTargetFollowers = Number(totalRows[0]?.total_target_followers ?? 0);
  return {
    targetOwner: ownerUsername,
    totalTargetFollowers,
    candidates: rows.map((r) => ({
      ownerUsername: r.owner_username,
      overlapCount: Number(r.overlap_count),
      overlapRatio: totalTargetFollowers
        ? parseFloat((Number(r.overlap_count) / totalTargetFollowers).toFixed(3))
        : 0,
    })),
  };
}

/**
 * Tool A3: Pola caption/hook dari post ber-engagement tertinggi (like_count).
 */
export async function executeAnalyzeHighPerformingHooks(sampleSize: number = 20) {
  const safeSample = Math.max(1, Math.min(30, Math.floor(sampleSize) || 20));
  const topPosts = await prisma.post.findMany({
    orderBy: { likeCount: "desc" },
    take: safeSample,
    select: { captionText: true },
  });
  const captions = topPosts.filter((p) => p.captionText).map((p) => p.captionText as string);
  if (!captions.length) return { sampleSize: 0, patterns: null };
  const prompt = `Berikut caption dari ${captions.length} post engagement tertinggi:
${captions.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Analisis pola yang sering muncul: gaya bukaan/hook, panjang rata-rata, emoji, call-to-action,
nada bahasa. Rangkum 4-6 poin actionable untuk content creator.`;
  return { sampleSize: captions.length, patterns: await callChatLLM(prompt) };
}

/**
 * Tool A4: Follower yang sama-sama me-repost dari DUA akun original berbeda.
 */
export async function executeGetFollowerOverlap(ownerA: string, ownerB: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT re.follower_username FROM repost_events re JOIN posts p ON p.id = re.post_id
     WHERE p.owner_username = $1
     INTERSECT
     SELECT re.follower_username FROM repost_events re JOIN posts p ON p.id = re.post_id
     WHERE p.owner_username = $2;`,
    ownerA, ownerB
  );
  return {
    ownerA,
    ownerB,
    overlapCount: rows.length,
    overlappingFollowers: rows.map((r) => r.follower_username).slice(0, 50),
  };
}

/**
 * Tool A5: Post lain yang mirip dengan satu post acuan (pakai embedding post itu
 * sendiri sebagai query, bukan teks baru).
 */
export async function executeFindSimilarPosts(postId: string, limit: number = 5) {
  const safeLimit = Math.max(1, Math.min(15, Math.floor(limit) || 5));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p2.id, p2.owner_username, p2.caption_text, p2.like_count, p2.raw_json,
            (SELECT COUNT(*)::int FROM repost_events re WHERE re.post_id = p2.id) AS repost_count,
            (p1.embedding <=> p2.embedding) AS distance
     FROM posts p1, posts p2
     WHERE p1.id = $1 AND p2.id != $1 AND p1.embedding IS NOT NULL AND p2.embedding IS NOT NULL
     ORDER BY distance ASC LIMIT $2;`,
    postId, safeLimit
  );
  return {
    basedOnPostId: postId,
    similarPosts: rows.map((r) => ({
      id: r.id,
      ownerUsername: r.owner_username,
      captionText: r.caption_text,
      likeCount: r.like_count,
      repostCount: Number(r.repost_count ?? 0),
      thumbnailUrl: extractThumbnailUrl(r.raw_json),
      similarity: parseFloat((1 - Number(r.distance)).toFixed(3)),
    })),
  };
}

/**
 * Tool A6: Hashtag yang sering muncul BERSAMAAN dengan satu hashtag acuan.
 */
export async function executeGetRelatedHashtags(hashtag: string, limit: number = 10) {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit) || 10));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT tag2 AS related_tag, COUNT(*)::int AS co_occurrence_count
     FROM posts p CROSS JOIN LATERAL unnest(p.hashtags) AS tag1
     CROSS JOIN LATERAL unnest(p.hashtags) AS tag2
     WHERE tag1 = $1 AND tag2 != $1
     GROUP BY tag2 ORDER BY co_occurrence_count DESC LIMIT $2;`,
    hashtag, safeLimit
  );
  return {
    hashtag,
    relatedHashtags: rows.map((r) => ({ tag: r.related_tag, count: Number(r.co_occurrence_count) })),
  };
}

/**
 * Tool A7-A8: Formatter murni (pola yang sama seperti render_chart) — tidak query
 * DB, hanya membentuk ulang data dari tool lain jadi komponen visual.
 */
export function executeRenderPostCard(post: {
  id: string;
  thumbnailUrl?: string;
  captionText?: string;
  ownerUsername?: string;
  likeCount?: number;
  repostCount?: number;
}) {
  return { isPostCard: true, ...post };
}

export function executeRenderTable(headers: string[], rows: (string | number)[][]) {
  return { isTable: true, headers, rows };
}

/**
 * Tool 4: Render Chart Generator (FR-6.4)
 */
export function executeRenderChart(
  chartType: "bar" | "line" | "area",
  title: string,
  data: { name: string; value: number }[]
) {
  return {
    isChart: true,
    chartType,
    title,
    data,
  };
}

/**
 * F11.1: Sintesis keresahan/kebutuhan yang BERULANG lintas banyak post dari sampel commentSummary terbaru.
 * Ini sintesis kualitatif dari sampel, BUKAN statistik pasti.
 */
export async function executeGetCommunitySentimentPulse(sampleSize: number = 30) {
  const safeSample = Math.max(5, Math.min(100, Math.floor(sampleSize) || 30));
  const postsWithSummary = await prisma.post.findMany({
    where: { commentSummary: { not: null } },
    orderBy: { lastUpdatedAt: "desc" },
    take: safeSample,
    select: { id: true, ownerUsername: true, commentSummary: true, topicLabel: true },
  });

  const totalPostsWithSummary = await prisma.post.count({ where: { commentSummary: { not: null } } });

  if (!postsWithSummary.length) {
    return {
      pulse: null,
      sampleSize: 0,
      totalPostsWithCommentSummary: totalPostsWithSummary,
      note: "Belum ada post dengan rangkuman komentar (comment_summary) di database. Jalankan scraping komentar terlebih dahulu.",
    };
  }

  const prompt = `Berikut rangkuman komentar dari ${postsWithSummary.length} post berbeda:
${postsWithSummary
  .map(
    (p, i) =>
      `${i + 1}. [Topik: ${p.topicLabel ?? "tidak diketahui"}, Kreator: @${p.ownerUsername ?? "anonim"}] ${p.commentSummary}`
  )
  .join("\n")}

Dari rangkuman-rangkuman di atas, sintesiskan dalam 5-7 poin: apa keresahan, kebutuhan, atau
harapan yang PALING SERING muncul lintas post (bukan satu post saja)? Kelompokkan per tema
kalau ada pola jelas. Bahasa Indonesia.`;

  let pulse: string | null = null;
  try {
    pulse = await callChatLLM(prompt);
  } catch (err: any) {
    pulse = `Gagal memanggil LLM: ${err?.message || String(err)}`;
  }

  return {
    sampleSize: postsWithSummary.length,
    totalPostsWithCommentSummary: totalPostsWithSummary,
    note: "Ini sintesis kualitatif dari sampel post terbaru, bukan statistik pasti seluruh database",
    pulse,
  };
}

/**
 * F11.2: Pertanyaan berulang dari audiens — bahan ide konten yang menjawab kebutuhan audiens.
 */
export async function executeDetectRecurringQuestions(sampleSize: number = 50) {
  const safeSample = Math.max(5, Math.min(100, Math.floor(sampleSize) || 50));
  const questionComments = await prisma.comment.findMany({
    where: { text: { contains: "?" } },
    orderBy: { likeCount: "desc" },
    take: safeSample,
    select: { text: true, likeCount: true, postId: true, commenterUsername: true },
  });

  if (!questionComments.length) {
    return {
      recurringQuestionThemes: null,
      sampleSize: 0,
      note: "Belum ditemukan komentar berbentuk pertanyaan di database.",
    };
  }

  const prompt = `Berikut komentar berbentuk pertanyaan dari audiens (diurutkan dari paling banyak disukai):
${questionComments.map((c, i) => `${i + 1}. [${c.likeCount ?? 0} suka] ${c.text}`).join("\n")}

Kelompokkan jadi tema pertanyaan yang BERULANG (bukan daftar mentah) — apa yang paling
sering ditanyakan/belum jelas bagi audiens? Rangkum 4-6 poin, Bahasa Indonesia. Bisa jadi
bahan konten yang menjawab pertanyaan tersebut.`;

  let recurringQuestionThemes: string | null = null;
  try {
    recurringQuestionThemes = await callChatLLM(prompt);
  } catch (err: any) {
    recurringQuestionThemes = `Gagal memanggil LLM: ${err?.message || String(err)}`;
  }

  return {
    sampleSize: questionComments.length,
    recurringQuestionThemes,
  };
}

/**
 * F11.3: Full-text search langsung ke teks komentar mentah untuk kutipan/contoh literal audiens.
 */
export async function executeSearchComments(query: string, limit: number = 15) {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit) || 15));
  const rows = await prisma.comment.findMany({
    where: { text: { contains: query, mode: "insensitive" } },
    orderBy: { likeCount: "desc" },
    take: safeLimit,
    include: {
      post: {
        select: {
          id: true,
          code: true,
          captionText: true,
          ownerUsername: true,
          topicLabel: true,
        },
      },
    },
  });

  return {
    query,
    count: rows.length,
    results: rows.map((c) => ({
      commentId: c.id,
      text: c.text,
      likeCount: c.likeCount,
      commenterUsername: c.commenterUsername,
      commentedAt: c.commentedAt ? c.commentedAt.toISOString().split("T")[0] : null,
      postId: c.postId,
      postCode: c.post.code,
      postCaption: c.post.captionText,
      postOwner: c.post.ownerUsername,
      postTopic: c.post.topicLabel,
    })),
  };
}

/**
 * F11.4: Komentar paling disukai di SELURUH database (lintas semua post).
 */
export async function executeGetMostLikedCommentsOverall(limit: number = 15) {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit) || 15));
  const rows = await prisma.comment.findMany({
    orderBy: { likeCount: "desc" },
    take: safeLimit,
    include: {
      post: {
        select: {
          id: true,
          code: true,
          captionText: true,
          ownerUsername: true,
          topicLabel: true,
        },
      },
    },
  });

  return {
    count: rows.length,
    results: rows.map((c) => ({
      commentId: c.id,
      text: c.text,
      likeCount: c.likeCount,
      commenterUsername: c.commenterUsername,
      postId: c.postId,
      postCode: c.post.code,
      postOwner: c.post.ownerUsername,
      postTopic: c.post.topicLabel,
      postCaption: c.post.captionText,
    })),
  };
}

/**
 * F11.5: Rasio komentar terhadap repost — membedakan konten 'pemicu diskusi' vs 'murni dibagikan'.
 */
export async function executeGetCommentToRepostRatio(limit: number = 15) {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit) || 15));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.code, p.caption_text, p.owner_username, p.topic_label,
            COUNT(DISTINCT c.id)::int AS comment_count,
            COUNT(DISTINCT re.id)::int AS repost_count,
            CASE WHEN COUNT(DISTINCT re.id) = 0 THEN NULL
                 ELSE ROUND(COUNT(DISTINCT c.id)::numeric / COUNT(DISTINCT re.id), 2)
            END AS comment_to_repost_ratio
     FROM posts p
     LEFT JOIN comments c ON c.post_id = p.id
     LEFT JOIN repost_events re ON re.post_id = p.id
     GROUP BY p.id, p.code, p.caption_text, p.owner_username, p.topic_label
     HAVING COUNT(DISTINCT re.id) > 0
     ORDER BY comment_to_repost_ratio DESC NULLS LAST
     LIMIT $1;`,
    safeLimit
  );

  return {
    note: "Ratio tinggi = konten memicu diskusi (banyak komentar relatif ke repost). Ratio rendah = konten 'murni dibagikan' tanpa banyak diskusi.",
    results: rows.map((r) => ({
      postId: r.id,
      code: r.code,
      captionText: r.caption_text,
      ownerUsername: r.owner_username,
      topicLabel: r.topic_label,
      commentCount: r.comment_count,
      repostCount: r.repost_count,
      ratio: r.comment_to_repost_ratio !== null ? Number(r.comment_to_repost_ratio) : null,
    })),
  };
}

/**
 * OpenAI / OpenRouter function tools schemas
 */
export const CHATBOT_TOOLS = [
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Melakukan pencarian semantik (vektor kemiripan pgvector) terhadap isi postingan repost followers @ynsurabaya. Gunakan ini HANYA untuk mencari dan membaca isi postingan tentang topik tertentu — BUKAN untuk menghitung distribusi, persentase, atau statistik frekuensi topik. Untuk analisis distribusi topik, gunakan tool 'analyze_topics'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Kata kunci atau kalimat pencarian semantik (misal: 'kajian pernikahan', 'boikot', 'nasihat sabar')",
          },
          limit: {
            type: "number",
            description: "Jumlah postingan maksimal yang diambil (default 5, maks 15)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_aggregate",
      description:
        "Mengambil data statistik/analitik agregat dari materialized view database (top akun di-repost, tren hashtag, dan grafik linimasa waktu). Gunakan ini jika pengguna bertanya tentang peringkat, jumlah, statistik, akun terpopuler, atau hashtag teratas.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["top_accounts", "trending_hashtags", "activity_timeline", "summary"],
            description: "Jenis metrik agregat yang diminta",
          },
          limit: {
            type: "number",
            description: "Jumlah data yang diambil (default 10)",
          },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_topics",
      description:
        "Menghitung distribusi HASHTAG LITERAL (per-tag, bukan topik semantik) dari seluruh database. Untuk pertanyaan 'topik/tema apa paling sering dibahas' atau 'distribusi topik', gunakan 'get_topic_distribution' (topik semantik yang mengelompokkan beberapa hashtag terkait), BUKAN tool ini dan BUKAN semantic_search. Tool ini cocok jika pengguna secara spesifik bertanya soal hashtag literal (bukan topik/tema).",
      parameters: {
        type: "object",
        properties: {
          topN: {
            type: "number",
            description: "Jumlah topik/hashtag teratas yang dikembalikan (default 10, maks 30)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_chart",
      description:
        "Merender grafik visual interaktif (bar, line, atau area chart) langsung di bubble percakapan pengguna. Panggil tool ini setiap kali pengguna meminta grafik, visualisasi, plot, atau perbandingan chart. Data grafik HARUS berasal dari hasil tool lain — JANGAN mengarang nilai.",
      parameters: {
        type: "object",
        properties: {
          chartType: {
            type: "string",
            enum: ["bar", "line", "area"],
            description: "Jenis grafik yang akan dirender",
          },
          title: {
            type: "string",
            description: "Judul grafik yang informatif",
          },
          data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Label sumbu X atau kategori" },
                value: { type: "number", description: "Nilai numerik data" },
              },
              required: ["name", "value"],
            },
            description: "Daftar data poin grafik — nilainya HARUS dari hasil tool, bukan dikarang",
          },
        },
        required: ["chartType", "title", "data"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_topic_distribution",
      description:
        "Menghitung distribusi TOPIK (kelompok semantik dari beberapa hashtag terkait, misal #sedekah + #infaq + #zakat -> 'Sedekah & Kedermawanan') dari SELURUH database repost. WAJIB dipakai untuk pertanyaan: 'topik apa paling sering/dominan dibahas', 'tema apa yang lagi ramai', 'distribusi topik', 'proporsi niche konten'. JANGAN PERNAH gunakan semantic_search atau analyze_topics untuk pertanyaan jenis ini — keduanya tidak representatif untuk distribusi topik (semantic_search hanya sampel kecil, analyze_topics hanya per-hashtag literal, bukan topik semantik).",
      parameters: {
        type: "object",
        properties: {
          topN: {
            type: "number",
            description: "Jumlah topik teratas yang dikembalikan (default 10, maks 30)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_post_detail",
      description:
        "Mengambil detail lengkap SATU postingan spesifik berdasarkan post ID (didapat dari field 'id' pada hasil semantic_search) — caption penuh, hashtag, deskripsi visual AI, daftar follower yang me-repost, dan rangkuman komentar jika tersedia. Gunakan untuk drill-down memberi contoh konkret setelah menemukan post relevan lewat semantic_search.",
      parameters: {
        type: "object",
        properties: {
          postId: {
            type: "string",
            description: "ID post Instagram (field 'id' dari hasil semantic_search atau get_post_detail sebelumnya)",
          },
        },
        required: ["postId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_shared_interest_clusters",
      description:
        "Segmentasi follower berdasarkan topik yang PALING SERING mereka repost (dominant interest) — tiap follower masuk ke satu klaster sesuai topik dominannya. Tool konteks RISET KOMUNITAS/KOLABORASI (misal programming event per-segmen minat, memetakan ceruk audiens), bukan analisis konten biasa. Jangan pakai untuk pertanyaan distribusi topik keseluruhan (pakai get_topic_distribution untuk itu).",
      parameters: {
        type: "object",
        properties: {
          minClusterSize: {
            type: "number",
            description: "Ukuran klaster minimum agar ditampilkan (default 3)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_collaboration_candidates",
      description:
        "Mencari akun original lain yang audiensnya paling beririsan (overlap) dengan followers suatu akun — kandidat kolaborasi/co-host event. Tool konteks RISET KOMUNITAS/KOLABORASI, bukan analisis konten biasa. Gunakan untuk pertanyaan seperti 'akun apa yang cocok diajak kolaborasi dengan akun X'.",
      parameters: {
        type: "object",
        properties: {
          ownerUsername: {
            type: "string",
            description: "Username akun original acuan (tanpa @)",
          },
          limit: {
            type: "number",
            description: "Jumlah kandidat (default 10, maks 20)",
          },
        },
        required: ["ownerUsername"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_high_performing_hooks",
      description:
        "Menganalisis pola caption/hook (gaya bukaan, panjang, emoji, call-to-action, nada bahasa) dari post ber-engagement (like) tertinggi — menghasilkan 4-6 poin actionable untuk content creator. Gunakan untuk pertanyaan seperti 'gaya caption seperti apa yang paling works' atau 'bikinkan panduan hook dari konten terbaik'.",
      parameters: {
        type: "object",
        properties: {
          sampleSize: {
            type: "number",
            description: "Jumlah post teratas yang dianalisis (default 20, maks 30)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_follower_overlap",
      description: "Mencari follower yang sama-sama me-repost dari DUA akun original berbeda — menunjukkan irisan minat audiens antara dua akun. Gunakan untuk pertanyaan seperti 'follower mana yang suka X dan Y sekaligus'.",
      parameters: {
        type: "object",
        properties: {
          ownerA: { type: "string", description: "Username akun original pertama" },
          ownerB: { type: "string", description: "Username akun original kedua" },
        },
        required: ["ownerA", "ownerB"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_similar_posts",
      description: "Mencari post lain yang MIRIP secara konten dengan satu post tertentu (pakai embedding post itu sendiri, bukan kata kunci baru). Gunakan setelah menemukan satu post menarik lewat semantic_search/get_post_detail dan user ingin melihat post serupa lainnya.",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string", description: "ID post yang jadi acuan kemiripan" },
          limit: { type: "number", description: "Jumlah post serupa (default 5, maks 15)" },
        },
        required: ["postId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_related_hashtags",
      description: "Mencari hashtag yang sering muncul BERSAMAAN dengan satu hashtag tertentu dalam post yang sama — membantu memetakan cluster topik di sekitar satu hashtag. BUKAN untuk mencari topik dominan keseluruhan (pakai get_topic_distribution untuk itu).",
      parameters: {
        type: "object",
        properties: {
          hashtag: { type: "string", description: "Hashtag acuan (tanpa tanda #)" },
          limit: { type: "number", description: "Jumlah hashtag terkait (default 10, maks 20)" },
        },
        required: ["hashtag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_post_card",
      description: "Menampilkan satu post sebagai kartu visual (thumbnail, caption, statistik) inline di chat. Data HARUS berasal dari hasil semantic_search/get_post_detail/find_similar_posts — JANGAN mengarang data post.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          thumbnailUrl: { type: "string" },
          captionText: { type: "string" },
          ownerUsername: { type: "string" },
          likeCount: { type: "number" },
          repostCount: { type: "number" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_table",
      description: "Menampilkan data sebagai tabel terstruktur di chat — dipakai saat data dari tool lain lebih mudah dipahami sebagai tabel dibanding teks biasa (misal perbandingan multi-kolom). Data HARUS berasal dari hasil tool lain, JANGAN mengarang.",
      parameters: {
        type: "object",
        properties: {
          headers: { type: "array", items: { type: "string" }, description: "Judul kolom" },
          rows: {
            type: "array",
            items: { type: "array", items: { type: ["string", "number"] } },
            description: "Baris data, tiap baris array nilai sejumlah kolom sesuai headers",
          },
        },
        required: ["headers", "rows"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_community_sentiment_pulse",
      description:
        "Mensintesiskan keresahan/kebutuhan/harapan yang berulang LINTAS BANYAK post dari sampel comment_summary terbaru. Ini SINTESIS KUALITATIF, BUKAN statistik pasti — jangan dipakai untuk klaim persentase/peringkat eksak (pakai get_topic_distribution untuk itu). Cocok untuk 'apa yang jadi concern komunitas belakangan ini', 'kebutuhan audiens secara umum'.",
      parameters: {
        type: "object",
        properties: { sampleSize: { type: "number", description: "default 30, rentang 5-100" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_recurring_questions",
      description:
        "Mendeteksi dan mengelompokkan pertanyaan yang berulang dari komentar audiens — bahan ide konten yang menjawab kebutuhan/kebingungan audiens. Gunakan untuk 'apa yang sering ditanyakan audiens'.",
      parameters: {
        type: "object",
        properties: { sampleSize: { type: "number", description: "default 50, rentang 5-100" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_comments",
      description:
        "Mencari teks komentar mentah secara langsung berdasarkan kata kunci — untuk menemukan kutipan/contoh literal dari audiens, bukan rangkuman. Gunakan saat user minta 'contoh komentar yang menyebut X' atau 'kutipan asli soal Y'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kata kunci pencarian" },
          limit: { type: "number", description: "default 15, maks 30" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_most_liked_comments_overall",
      description:
        "Komentar paling disukai di SELURUH database (lintas semua post) — sinyal paling 'disetujui' massal secara keseluruhan, bukan per post. Gunakan untuk 'komentar paling viral/didukung banyak orang'.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "default 15, maks 30" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_comment_to_repost_ratio",
      description:
        "Membandingkan rasio jumlah komentar terhadap jumlah repost per post — membedakan konten 'pemicu diskusi' (komentar tinggi, repost rendah) vs konten 'murni dibagikan' (repost tinggi, komentar rendah). Gunakan untuk pertanyaan soal jenis konten yang memicu diskusi vs yang cuma dibagikan.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "default 15, maks 30" } },
        required: [],
      },
    },
  },
];
