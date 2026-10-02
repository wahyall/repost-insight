# Prompt: Tools Baru & Perbaikan Cakupan Topik — RepostInsight Chatbot

Task brief berdiri sendiri untuk Claude Code. Ini **lanjutan** dari `PROMPT-UPGRADE-CHATBOT.md` (yang sudah diimplementasi) — jangan ulangi kerjaan di situ (agentic loop, system prompt, `get_topic_distribution` dasar sudah ada), cuma tambahkan yang di bawah ini.

---

## Task A — Tambah 8 Tool Baru

### A1. `get_shared_interest_clusters`
Segmentasi follower berdasarkan topik yang PALING SERING mereka repost (dominant interest), berguna untuk programming event per-segmen minat.

```ts
export async function executeGetSharedInterestClusters(minClusterSize: number = 3) {
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
    minClusterSize
  );
  return {
    note: "Tiap follower dikelompokkan berdasarkan topik yang PALING SERING mereka repost",
    clusters: rows.map((r) => ({
      topic: r.topic_label,
      clusterSize: r.cluster_size,
      sampleFollowers: r.followers.slice(0, 20),
    })),
  };
}
```
*(Catatan: query ini pakai `p.topic_label` langsung — lihat Task B, kolom ini baru ada setelah Task B diimplementasi. Kalau mau tool ini jalan duluan sebelum Task B, pakai join lewat `hashtag_topics` seperti versi `mv_topic_distribution` lama.)*

### A2. `suggest_collaboration_candidates`
Akun original dengan audiens overlap tinggi ke followers suatu akun — kandidat kolaborasi/co-host event.

```ts
export async function executeSuggestCollaborationCandidates(ownerUsername: string, limit: number = 10) {
  const safeLimit = Math.max(1, Math.min(20, limit));
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
  const [{ total_target_followers }] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(DISTINCT re.follower_username)::int AS total_target_followers
     FROM repost_events re JOIN posts p ON p.id = re.post_id WHERE p.owner_username = $1;`,
    ownerUsername
  );
  return {
    targetOwner: ownerUsername,
    totalTargetFollowers: total_target_followers,
    candidates: rows.map((r) => ({
      ownerUsername: r.owner_username,
      overlapCount: r.overlap_count,
      overlapRatio: total_target_followers ? parseFloat((r.overlap_count / total_target_followers).toFixed(3)) : 0,
    })),
  };
}
```

### A3. `analyze_high_performing_hooks`
Pola caption/hook dari post ber-engagement tertinggi.

```ts
export async function executeAnalyzeHighPerformingHooks(sampleSize: number = 20) {
  const topPosts = await prisma.post.findMany({
    orderBy: { likeCount: "desc" },
    take: sampleSize,
    select: { captionText: true },
  });
  const captions = topPosts.filter((p) => p.captionText).map((p) => p.captionText);
  if (!captions.length) return { patterns: null };
  const prompt = `Berikut caption dari ${captions.length} post engagement tertinggi:
${captions.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Analisis pola yang sering muncul: gaya bukaan/hook, panjang rata-rata, emoji, call-to-action,
nada bahasa. Rangkum 4-6 poin actionable untuk content creator.`;
  return { sampleSize: captions.length, patterns: await callChatLLM(prompt) };
}
```

### A4. `get_follower_overlap`
Follower yang sama-sama me-repost dari DUA akun original berbeda — irisan minat audiens.

```ts
export async function executeGetFollowerOverlap(ownerA: string, ownerB: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT re.follower_username FROM repost_events re JOIN posts p ON p.id = re.post_id
     WHERE p.owner_username = $1
     INTERSECT
     SELECT re.follower_username FROM repost_events re JOIN posts p ON p.id = re.post_id
     WHERE p.owner_username = $2;`,
    ownerA, ownerB
  );
  return { ownerA, ownerB, overlapCount: rows.length, overlappingFollowers: rows.map((r) => r.follower_username).slice(0, 50) };
}
```

### A5. `find_similar_posts`
Cari post lain yang mirip dengan satu post tertentu — pakai embedding post itu sendiri sebagai query, bukan teks baru.

```ts
export async function executeFindSimilarPosts(postId: string, limit: number = 5) {
  const safeLimit = Math.max(1, Math.min(15, limit));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p2.id, p2.owner_username, p2.caption_text, p2.like_count,
            (p1.embedding <=> p2.embedding) AS distance
     FROM posts p1, posts p2
     WHERE p1.id = $1 AND p2.id != $1 AND p1.embedding IS NOT NULL AND p2.embedding IS NOT NULL
     ORDER BY distance ASC LIMIT $2;`,
    postId, safeLimit
  );
  return { basedOnPostId: postId, similarPosts: rows.map((r) => ({ id: r.id, ownerUsername: r.owner_username, captionText: r.caption_text, similarity: parseFloat((1 - r.distance).toFixed(3)) })) };
}
```

### A6. `get_related_hashtags`
Hashtag yang sering muncul BERSAMAAN dengan satu hashtag tertentu — memetakan cluster topik di sekitar satu hashtag.

```ts
export async function executeGetRelatedHashtags(hashtag: string, limit: number = 10) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT tag2 AS related_tag, COUNT(*)::int AS co_occurrence_count
     FROM posts p CROSS JOIN LATERAL unnest(p.hashtags) AS tag1
     CROSS JOIN LATERAL unnest(p.hashtags) AS tag2
     WHERE tag1 = $1 AND tag2 != $1
     GROUP BY tag2 ORDER BY co_occurrence_count DESC LIMIT $2;`,
    hashtag, Math.max(1, Math.min(20, limit))
  );
  return { hashtag, relatedHashtags: rows.map((r) => ({ tag: r.related_tag, count: r.co_occurrence_count })) };
}
```

### A7-A8. `render_post_card` & `render_table`
Formatter murni (sama pola seperti `render_chart` yang sudah ada) — tidak query DB, cuma membentuk ulang data dari tool lain jadi komponen visual.

```ts
export function executeRenderPostCard(post: { id: string; thumbnailUrl?: string; captionText?: string; ownerUsername?: string; likeCount?: number; repostCount?: number }) {
  return { isPostCard: true, ...post };
}
export function executeRenderTable(headers: string[], rows: (string | number)[][]) {
  return { isTable: true, headers, rows };
}
```

### Schema `CHATBOT_TOOLS` untuk A4-A8

```ts
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
```

Daftarkan kedelapan tool (A1-A8) ke `CHATBOT_TOOLS` — `get_shared_interest_clusters` dan `suggest_collaboration_candidates` disebutkan eksplisit sebagai tool untuk konteks riset komunitas/kolaborasi, bukan analisis konten biasa.

---

## Task B — Perbaikan Cakupan Klasifikasi Topik (dari 49,4% → mendekati 100%)

**Root cause**: `mv_topic_distribution` versi lama cuma menghitung repost_event yang POST-nya punya hashtag YANG SUDAH diklasifikasi di `hashtag_topics`. Dua celah:
1. Hashtag yang belum sempat diklasifikasi (`reclassifyHashtagTopics()` belum tuntas) — bisa dikejar.
2. Post TANPA hashtag sama sekali — hashtag-based classification nggak akan pernah menjangkau ini.

**Fix**: tambah kolom `topic_label` langsung di `posts`, isi lewat DUA jalur — jalur cepat (copy dari hashtag yang sudah ter-mapping, tanpa LLM) dan jalur fallback (klasifikasi dari ISI KONTEN untuk post tanpa hashtag/belum ke-mapping).

```sql
ALTER TABLE posts ADD COLUMN topic_label text; -- NULL = belum diklasifikasi
```

```ts
const POST_BATCH_SIZE = 25;

async function classifyPostTopics() {
  let existingTopics = await getDistinctTopicLabels();
  const hashtagTopicCache = await getHashtagTopicMap(); // Map<hashtag, topic_label>

  while (true) {
    const batch = await prisma.post.findMany({
      where: { topicLabel: null },
      take: POST_BATCH_SIZE,
      select: { id: true, hashtags: true, captionText: true, visualDescription: true, commentSummary: true },
    });
    if (batch.length === 0) break;

    const fastLane: { id: string; topicLabel: string }[] = [];
    const needsContentClassification: typeof batch = [];

    for (const post of batch) {
      const mapped = post.hashtags.map((h) => hashtagTopicCache.get(h)).find((t) => t && t !== "Lainnya");
      if (mapped) fastLane.push({ id: post.id, topicLabel: mapped });
      else needsContentClassification.push(post);
    }

    await Promise.all(
      fastLane.map((f) => prisma.post.update({ where: { id: f.id }, data: { topicLabel: f.topicLabel } }))
    );

    if (needsContentClassification.length) {
      const parsed = JSON.parse(await callChatLLM(buildContentClassificationPrompt(existingTopics, needsContentClassification)));
      await Promise.all(
        parsed.map((p: any) => prisma.post.update({ where: { id: p.id }, data: { topicLabel: p.topic_label } }))
      );
      existingTopics = [...new Set([...existingTopics, ...parsed.map((p: any) => p.topic_label)])];
    }

    await sleep(1000);
  }

  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_topic_distribution;`);
}

function buildContentClassificationPrompt(existingTopics: string[], posts: any[]) {
  const list = posts.map((p, i) =>
    `${i + 1}. [id:${p.id}] Caption: "${p.captionText ?? "-"}" | Deskripsi visual: "${p.visualDescription ?? "-"}" | Rangkuman komentar: "${p.commentSummary ?? "-"}"`
  ).join("\n");
  return `Berikut daftar topik yang SUDAH ada (pakai ulang kalau cocok):
${existingTopics.map((t) => `- ${t}`).join("\n") || "(belum ada)"}

Berikut post tanpa hashtag/belum ter-mapping, klasifikasikan tiap post ke SATU topik
berdasarkan isi caption/deskripsi visual/rangkuman komentarnya:
${list}

Kalau isi post benar-benar tidak cukup informasi (semua field kosong/"-"), beri
topic_label = "Tidak terklasifikasi" — jangan dipaksakan mengarang topik. Jawab HANYA JSON:
[{"id":"...","topic_label":"..."}]`;
}
```

**Update `mv_topic_distribution`** supaya sumbernya langsung dari `posts.topic_label` (lebih simpel, dan otomatis mencakup post tanpa hashtag juga):

```sql
DROP MATERIALIZED VIEW IF EXISTS mv_topic_distribution;
CREATE MATERIALIZED VIEW mv_topic_distribution AS
SELECT
  p.topic_label,
  COUNT(*) AS repost_event_count,
  COUNT(DISTINCT p.id) AS unique_post_count,
  COUNT(DISTINCT re.follower_username) AS unique_reposters_count
FROM repost_events re
JOIN posts p ON p.id = re.post_id
WHERE p.topic_label IS NOT NULL
GROUP BY p.topic_label;
```

**Buat catatan cakupan jadi kondisional** (jangan selalu muncul — cuma relevan kalau cakupan masih jauh dari lengkap) di `executeGetTopicDistribution`:

```ts
const coveragePct = (classifiedRepostEvents / totalRepostEvents) * 100;
return {
  ...,
  coverageNote: coveragePct < 95
    ? `Analisis mencakup ${coveragePct.toFixed(1)}% (${classifiedRepostEvents} dari ${totalRepostEvents} repost events) data yang sudah terklasifikasi topiknya.`
    : undefined, // sembunyikan catatan kalau cakupan sudah tinggi
};
```

Panggil `classifyPostTopics()` sekali saat worker start (menuntaskan backlog post lama), lalu jadwalkan berkala seperti `reclassifyHashtagTopics()`.

## Kriteria Selesai

- [ ] 8 tool baru (A1-A8) terdaftar dan berfungsi
- [ ] Kolom `posts.topic_label` terisi untuk SEMUA post (lewat jalur cepat atau fallback konten) — cek `SELECT COUNT(*) FROM posts WHERE topic_label IS NULL` mendekati 0 (sisa cuma yang genuinely "Tidak terklasifikasi")
- [ ] `get_topic_distribution` sekarang mencakup >90% repost_events (naik signifikan dari 49,4%)
- [ ] Catatan cakupan cuma muncul kalau cakupan masih di bawah 95%, tidak selalu muncul
- [ ] Uji manual: tanya ulang "5 topik paling sering dibahas" — bandingkan hasil sebelum/sesudah, pastikan tidak ada lagi topik langka yang nongol di top-5 karena sampling bias

## Batasan

- Jangan ubah ulang agentic loop/system prompt dari `PROMPT-UPGRADE-CHATBOT.md` — itu sudah selesai.
- Post yang benar-benar tidak punya informasi apa pun (caption kosong, belum ada visual_description, belum ada comment_summary) boleh tetap "Tidak terklasifikasi" — jangan dipaksa 100% dengan mengarang.
