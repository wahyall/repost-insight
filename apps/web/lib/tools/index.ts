import { prisma } from "@repostinsight/db";

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

    // 2. Rentang waktu GLOBAL seluruh database (bukan hanya dari kandidat window)
    const tsRange: any[] = await prisma.$queryRawUnsafe(
      `SELECT EXTRACT(EPOCH FROM MIN(taken_at))::bigint AS min_ts,
              EXTRACT(EPOCH FROM MAX(taken_at))::bigint AS max_ts
       FROM posts WHERE taken_at IS NOT NULL AND embedding IS NOT NULL;`
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

    // 4. Re-rank dengan global-normalized recency
    const reranked = candidatePosts.map((p) => {
      const similarity = Math.max(0, 1 - (p.distance ?? 1));
      const ts = p.taken_at
        ? Math.floor(new Date(p.taken_at).getTime() / 1000)
        : globalMinTs;
      const recencyScore = (ts - globalMinTs) / globalTsRange;
      const combinedScore = SIMILARITY_WEIGHT * similarity + RECENCY_WEIGHT * recencyScore;
      return { ...p, similarity, recencyScore, combinedScore };
    });

    reranked.sort((a, b) => b.combinedScore - a.combinedScore);
    const topPosts = reranked.slice(0, safeLimit);

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
        "Menghitung distribusi topik/tema nyata dari SELURUH database berdasarkan hashtag yang terkandung di postingan yang di-repost. Gunakan tool ini (bukan semantic_search) setiap kali pengguna bertanya: 'topik apa paling sering dibahas', 'tema dominan', 'distribusi konten', 'proporsi topik', 'kategori konten terbanyak', atau meminta grafik distribusi topik/niche.",
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
];
