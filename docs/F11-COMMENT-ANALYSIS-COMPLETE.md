# RepostInsight — F11: Comment Analysis (Dokumen Lengkap & Mandiri)

| | |
|---|---|
| **Dokumen** | Spesifikasi & Implementasi Fitur F11 — Comment Analysis |
| **Proyek** | RepostInsight |
| **Versi** | 2.0 — konsolidasi final |
| **Tanggal** | 1 Oktober 2026 |

---

## 1. Ringkasan & Rationale

Selain caption, hashtag, dan konten visual, **komentar** pada post original adalah sinyal audiens paling kaya — memuat pujian, tapi juga keresahan, kritik, dan saran yang tidak terlihat dari caption/visual saja. Fitur ini:

1. Scrape komentar per **post unik** (satu post yang di-repost banyak follower cukup di-scrape komentarnya sekali — bukan per repost event, bukan per follower).
2. Rangkum komentar tiap post jadi `comment_summary` lewat LLM, yang ikut masuk ke teks yang di-embed untuk RAG.
3. Sediakan beberapa tool chatbot untuk memanfaatkan data komentar secara maksimal — baik di level satu post maupun lintas seluruh database.

## 2. Actor Apify: `louisdeconinck/instagram-comments-scraper`

**Input:**
```json
{
  "urls": ["<shortcode atau URL post>"],
  "maxComments": 15
}
```
Actor menerima shortcode mentah langsung (tidak perlu URL lengkap) — pakai `post.code` yang sudah tersimpan dari hasil scraping repost.

**Output per komentar** (field yang dipakai dari output actor — field mentah dari Instagram sebenarnya lebih banyak dari ini):
```json
{
  "pk": "17991547818025624",
  "created_at": 1790598052,
  "text": "...",
  "comment_like_count": 48,
  "is_ranked_comment": false,
  "child_comment_count": 0,
  "user": { "username": "..." }
}
```

**Catatan penting soal actor ini:**
- **Free tier Apify dibatasi 15 komentar/post**, apa pun nilai `maxComments` yang diisi — tanpa billing terpasang di akun Apify terkait, 15 adalah batas riil. Default `maxComments: 15` konsisten dengan strategi budget Rp0 proyek ini (naikkan cuma kalau sudah pasang billing).
- Harga: $0.001/komentar + $0.001/run — sangat murah dibanding actor lain yang pernah dipertimbangkan.
- **Tidak ada parameter sort-by-popular yang terkonfirmasi** dari actor ini — komentar kemungkinan datang dalam urutan API Instagram (bukan otomatis terurut like terbanyak). **Urutkan ulang manual di kode** berdasarkan `comment_like_count` sebelum dipakai untuk rangkuman (lihat §5).
- `user.username` tersedia di output asli — tetap perlakukan sebagai nullable di skema, jaga-jaga kalau API Instagram sesekali tidak mengembalikannya untuk komentar tertentu.
- Actor cuma ambil **top-level comment** (reply/nested comment tidak ikut ter-scrape) — cukup untuk kebutuhan analisis sentimen/kritik di versi ini; threading penuh di luar scope.
- Actor ini **tidak sensitif waktu** seperti scraping gambar/video (F10) — dipanggil pakai shortcode permanen, bukan URL CDN yang kedaluwarsa dalam 1-2 hari. Boleh berjalan sebagai antrean async biasa, tidak perlu buru-buru di siklus scraping yang sama.

## 3. Perubahan Data Model

```sql
ALTER TABLE posts ADD COLUMN comments_status text NOT NULL DEFAULT 'pending'; -- pending/done/failed/skipped
ALTER TABLE posts ADD COLUMN comment_summary text;

CREATE TABLE comments (
  id                   text PRIMARY KEY,        -- dari field `pk` actor
  post_id              text NOT NULL REFERENCES posts(id),
  commenter_username   text,                     -- dari user.username, nullable
  text                 text,
  like_count           int,
  is_ranked_comment    boolean,
  child_comment_count  int,
  commented_at         timestamptz,
  scraped_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_post_id ON comments(post_id);
```

## 4. Functional Requirements

| ID | Requirement |
|---|---|
| FR-11.1 | Setiap post unik di-scrape komentarnya sekali lewat `louisdeconinck/instagram-comments-scraper`, `maxComments: 15` (default) |
| FR-11.2 | Post dengan `comment_count = 0` (sudah diketahui dari data scraping repost) langsung `comments_status = 'skipped'` tanpa memanggil actor — hemat biaya actor-start |
| FR-11.3 | Komentar hasil scrape **diurutkan ulang manual di kode** berdasarkan `like_count` sebelum dipakai untuk rangkuman — actor tidak menjamin urutan popularitas |
| FR-11.4 | Setelah komentar tersimpan, panggil LLM teks untuk merangkum keresahan/kritik/saran jadi `posts.comment_summary` |
| FR-11.5 | `comment_summary` ikut digabung ke teks yang di-embed (hashtags + visual_description + comment_summary + caption_text), memicu reset `embedding_status = 'pending'` — pola sama seperti F10/FR-10.4 |
| FR-11.6 | Proses TIDAK sensitif waktu (pakai shortcode, bukan URL CDN) — berjalan sebagai antrean async biasa seperti F5, bukan sinkron seperti F10 |
| FR-11.7 | Dispatch memakai infrastruktur rotasi multi API-key yang sama (F3) — actor ID dibuat konfigurabel, bukan hardcode satu actor per key/worker |
| FR-11.8 | Kegagalan (post dihapus/private/komentar dimatikan pemilik) → `comments_status = 'failed'`, tidak retry tanpa batas |
| FR-11.9 | Antara F2 (scraping repost, prioritas inti) dan F11 (pelengkap) memperebutkan kuota Apify yang sama — F2 diprioritaskan; F11 boleh berhenti sementara saat kuota ketat tanpa mengganggu pipeline inti |
| FR-11.10 | Komentar yang teksnya (setelah dinormalisasi) terduplikasi ≥3 kali dalam satu post — pola engagement-bait seperti caption "komen 'alasanku' nanti aku kirim link" — **dibuang dari input rangkuman LLM**. Tetap disimpan utuh di tabel `comments` (data mentah tidak diubah), cuma tidak ikut jadi bahan `comment_summary` |

## 5. Alur Kerja Lengkap

```ts
async function scrapeCommentsForPost(post: Post, apifyKey: ApifyApiKey) {
  // FR-11.2
  if (post.commentCount === 0) {
    await db.post.update({ where: { id: post.id }, data: { commentsStatus: "skipped" } });
    return;
  }

  const run = await apifyClient.startRun("louisdeconinck~instagram-comments-scraper", apifyKey, {
    urls: [post.code],
    maxComments: 15,
  });
  const items = await apifyClient.waitAndGetDataset(run);

  await db.comment.createMany({
    data: items.map((c: any) => ({
      id: c.pk,
      postId: post.id,
      commenterUsername: c.user?.username ?? null,
      text: c.text,
      likeCount: c.comment_like_count ?? 0,
      isRankedComment: c.is_ranked_comment ?? null,
      childCommentCount: c.child_comment_count ?? null,
      commentedAt: new Date(c.created_at * 1000),
    })),
    skipDuplicates: true,
  });

  // FR-11.10 — buang komentar "bait" (duplikat teks berulang dalam post yang sama, pola
  // "komen X maka aku kirim link") SEBELUM dipakai untuk rangkuman. Data mentah di tabel
  // comments tetap utuh (createMany di atas tidak terpengaruh).
  const signalComments = filterLowSignalComments(items);

  // FR-11.3 — urutkan ulang manual, actor tidak menjamin urutan popularitas
  const topComments = signalComments
    .slice()
    .sort((a: any, b: any) => (b.comment_like_count ?? 0) - (a.comment_like_count ?? 0))
    .slice(0, 15);

  // Kalau SEMUA komentar ternyata bait/duplikat, tidak ada sinyal untuk dirangkum
  const summary = topComments.length
    ? await callChatLLM(buildCommentSummaryPrompt(post.captionText, topComments))
    : null;

  await db.post.update({
    where: { id: post.id },
    data: {
      commentSummary: summary,
      commentsStatus: "done",
      ...(summary ? { embeddingStatus: "pending" } : {}), // cuma re-embed kalau ada summary baru — FR-11.4, FR-11.5
    },
  });
}

/**
 * Normalisasi teks komentar untuk deteksi duplikat: lowercase, buang emoji/simbol,
 * rapikan spasi. "Alasanku", "alasanku", "alasanku🙌" semua jadi "alasanku".
 */
function normalizeCommentText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FR-11.10 — buang grup komentar yang teksnya (setelah normalisasi) muncul >= dupThreshold
 * kali dalam satu post. Ini menangkap pola engagement-bait ("komen alasanku maka aku kirim
 * link") tanpa perlu daftar frasa spesifik — bait selalu menghasilkan banyak orang mengetik
 * teks yang nyaris identik, siapa pun captionnya.
 */
function filterLowSignalComments<T extends { text: string }>(comments: T[], dupThreshold = 3): T[] {
  const groups = new Map<string, T[]>();
  for (const c of comments) {
    const key = normalizeCommentText(c.text);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const filtered: T[] = [];
  for (const group of groups.values()) {
    if (group.length >= dupThreshold) continue; // bait/duplikat berulang — buang semua anggotanya
    filtered.push(...group);
  }
  return filtered;
}

function buildCommentSummaryPrompt(caption: string | null, comments: { text: string; comment_like_count: number }[]) {
  const list = comments.map((c, i) => `${i + 1}. [${c.comment_like_count ?? 0} suka] ${c.text}`).join("\n");
  return `Berikut caption asli: "${caption ?? "(tidak ada caption)"}"

Berikut komentar pada postingan ini, diurutkan dari yang paling banyak disukai:
${list}

Rangkum dalam 3-5 kalimat Bahasa Indonesia: keresahan, kritik, atau saran apa yang paling
sering muncul atau paling banyak didukung (dilihat dari jumlah suka)? Kalau sebagian besar
cuma pujian/emoji tanpa substansi, sebutkan itu saja singkat — jangan mengada-ada.`;
}
```

**Penjadwalan**: panggil `scrapeCommentsForPost()` sebagai loop async terpisah (pola sama seperti embedding worker F5) — ambil batch post `comments_status = 'pending'`, proses, lanjut. Boleh jalan lebih lambat/prioritas lebih rendah dibanding scraping repost (F2) saat kuota Apify ketat (FR-11.9).

**Catatan cakupan tool lain**: `detect_recurring_questions` (filter `text contains "?"`) dan `get_most_liked_comments_overall` (urut `like_count DESC`) secara alami jarang terganggu pola bait ini (bait biasanya 0 suka dan tidak berbentuk pertanyaan), jadi tidak wajib difilter ulang — tapi boleh dipakaikan `filterLowSignalComments()` yang sama juga kalau suatu saat terasa perlu.

## 6. Tools Chatbot Terkait Komentar

### 6.1 `get_community_sentiment_pulse`
Sintesis keresahan/kebutuhan yang BERULANG lintas banyak post — bukan dari satu post saja. **Ini sintesis kualitatif dari sampel, BUKAN statistik pasti** (beda dari `get_topic_distribution` yang whole-database) — jangan dipakai untuk klaim persentase/peringkat eksak.

```ts
export async function executeGetCommunitySentimentPulse(sampleSize: number = 30) {
  const postsWithSummary = await prisma.post.findMany({
    where: { commentSummary: { not: null } },
    orderBy: { lastUpdatedAt: "desc" },
    take: sampleSize,
    select: { id: true, ownerUsername: true, commentSummary: true, topicLabel: true },
  });
  if (!postsWithSummary.length) return { pulse: null, sampleSize: 0 };

  const prompt = `Berikut rangkuman komentar dari ${postsWithSummary.length} post berbeda:
${postsWithSummary.map((p, i) => `${i + 1}. [Topik: ${p.topicLabel ?? "tidak diketahui"}] ${p.commentSummary}`).join("\n")}

Dari rangkuman-rangkuman di atas, sintesiskan dalam 5-7 poin: apa keresahan, kebutuhan, atau
harapan yang PALING SERING muncul lintas post (bukan satu post saja)? Kelompokkan per tema
kalau ada pola jelas. Bahasa Indonesia.`;

  return {
    sampleSize: postsWithSummary.length,
    totalPostsWithCommentSummary: await prisma.post.count({ where: { commentSummary: { not: null } } }),
    note: "Ini sintesis kualitatif dari sampel post terbaru, bukan statistik pasti seluruh database",
    pulse: await callChatLLM(prompt),
  };
}
```

### 6.2 `detect_recurring_questions`
Pertanyaan berulang dari audiens — bahan ide konten yang langsung menjawab kebutuhan mereka.

```ts
export async function executeDetectRecurringQuestions(sampleSize: number = 50) {
  const questionComments = await prisma.comment.findMany({
    where: { text: { contains: "?" } },
    orderBy: { likeCount: "desc" },
    take: sampleSize,
    select: { text: true, likeCount: true, postId: true },
  });
  if (!questionComments.length) return { questions: null, sampleSize: 0 };

  const prompt = `Berikut komentar berbentuk pertanyaan dari audiens (diurutkan dari paling
banyak disukai):
${questionComments.map((c, i) => `${i + 1}. [${c.likeCount ?? 0} suka] ${c.text}`).join("\n")}

Kelompokkan jadi tema pertanyaan yang BERULANG (bukan daftar mentah) — apa yang paling
sering ditanyakan/belum jelas bagi audiens? Rangkum 4-6 poin, Bahasa Indonesia. Bisa jadi
bahan konten yang menjawab pertanyaan tersebut.`;
  return { sampleSize: questionComments.length, recurringQuestionThemes: await callChatLLM(prompt) };
}
```

### 6.3 `search_comments`
Full-text search langsung ke teks komentar mentah — untuk kutipan/contoh literal, bukan rangkuman.

```ts
export async function executeSearchComments(query: string, limit: number = 15) {
  const safeLimit = Math.max(1, Math.min(30, limit));
  const rows = await prisma.comment.findMany({
    where: { text: { contains: query, mode: "insensitive" } },
    orderBy: { likeCount: "desc" },
    take: safeLimit,
    include: { post: { select: { captionText: true, ownerUsername: true } } },
  });
  return {
    query,
    results: rows.map((c) => ({
      text: c.text,
      likeCount: c.likeCount,
      commenterUsername: c.commenterUsername,
      postCaption: c.post.captionText,
      postOwner: c.post.ownerUsername,
    })),
  };
}
```

### 6.4 `get_most_liked_comments_overall`
Komentar paling disukai di SELURUH database (lintas semua post) — bukan per post.

```ts
export async function executeGetMostLikedCommentsOverall(limit: number = 15) {
  const safeLimit = Math.max(1, Math.min(30, limit));
  const rows = await prisma.comment.findMany({
    orderBy: { likeCount: "desc" },
    take: safeLimit,
    include: { post: { select: { captionText: true, ownerUsername: true, topicLabel: true } } },
  });
  return {
    results: rows.map((c) => ({
      text: c.text,
      likeCount: c.likeCount,
      postOwner: c.post.ownerUsername,
      postTopic: c.post.topicLabel,
    })),
  };
}
```

### 6.5 `get_comment_to_repost_ratio`
Bedakan konten "pemicu diskusi" (komentar tinggi, repost rendah) vs "murni dibagikan" (repost tinggi, komentar rendah).

```ts
export async function executeGetCommentToRepostRatio(limit: number = 15) {
  const safeLimit = Math.max(1, Math.min(30, limit));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.caption_text, p.owner_username,
            COUNT(DISTINCT c.id)::int AS comment_count,
            COUNT(DISTINCT re.id)::int AS repost_count,
            CASE WHEN COUNT(DISTINCT re.id) = 0 THEN NULL
                 ELSE ROUND(COUNT(DISTINCT c.id)::numeric / COUNT(DISTINCT re.id), 2)
            END AS comment_to_repost_ratio
     FROM posts p
     LEFT JOIN comments c ON c.post_id = p.id
     LEFT JOIN repost_events re ON re.post_id = p.id
     GROUP BY p.id, p.caption_text, p.owner_username
     HAVING COUNT(DISTINCT re.id) > 0
     ORDER BY comment_to_repost_ratio DESC NULLS LAST
     LIMIT $1;`,
    safeLimit
  );
  return {
    note: "Ratio tinggi = konten memicu diskusi (banyak komentar relatif ke repost). Ratio rendah = konten 'murni dibagikan' tanpa banyak diskusi.",
    results: rows.map((r) => ({
      postId: r.id, captionText: r.caption_text, ownerUsername: r.owner_username,
      commentCount: r.comment_count, repostCount: r.repost_count, ratio: r.comment_to_repost_ratio,
    })),
  };
}
```

### 6.6 Schema `CHATBOT_TOOLS` untuk kelima tool di atas

```ts
{
  type: "function",
  function: {
    name: "get_community_sentiment_pulse",
    description: "Mensintesiskan keresahan/kebutuhan/harapan yang berulang LINTAS BANYAK post dari sampel comment_summary terbaru. Ini SINTESIS KUALITATIF, BUKAN statistik pasti — jangan dipakai untuk klaim persentase/peringkat eksak (pakai get_topic_distribution untuk itu). Cocok untuk 'apa yang jadi concern komunitas belakangan ini', 'kebutuhan audiens secara umum'.",
    parameters: {
      type: "object",
      properties: { sampleSize: { type: "number", description: "default 30" } },
      required: [],
    },
  },
},
{
  type: "function",
  function: {
    name: "detect_recurring_questions",
    description: "Mendeteksi dan mengelompokkan pertanyaan yang berulang dari komentar audiens — bahan ide konten yang menjawab kebutuhan/kebingungan audiens. Gunakan untuk 'apa yang sering ditanyakan audiens'.",
    parameters: {
      type: "object",
      properties: { sampleSize: { type: "number", description: "default 50" } },
      required: [],
    },
  },
},
{
  type: "function",
  function: {
    name: "search_comments",
    description: "Mencari teks komentar mentah secara langsung berdasarkan kata kunci — untuk menemukan kutipan/contoh literal dari audiens, bukan rangkuman. Gunakan saat user minta 'contoh komentar yang menyebut X' atau 'kutipan asli soal Y'.",
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
    description: "Komentar paling disukai di SELURUH database (lintas semua post) — sinyal paling 'disetujui' massal secara keseluruhan, bukan per post. Gunakan untuk 'komentar paling viral/didukung banyak orang'.",
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
    description: "Membandingkan rasio jumlah komentar terhadap jumlah repost per post — membedakan konten 'pemicu diskusi' (komentar tinggi, repost rendah) vs konten 'murni dibagikan' (repost tinggi, komentar rendah). Gunakan untuk pertanyaan soal jenis konten yang memicu diskusi vs yang cuma dibagikan.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "default 15, maks 30" } },
      required: [],
    },
  },
},
```

### 6.7 Integrasi dengan `get_post_detail` (kalau sudah ada dari upgrade chatbot sebelumnya)

Pastikan `get_post_detail` membawa `commentSummary` dan beberapa top comment dari post terkait:
```ts
comments: { orderBy: { likeCount: "desc" }, take: 10 },
// ...
commentSummary: post.commentSummary ?? null,
topComments: post.comments?.map((c) => ({ text: c.text, likeCount: c.likeCount })) ?? [],
```

## 7. Pertimbangan Non-Functional

- **Biaya**: $0.001/komentar + $0.001/run. Dengan `maxComments: 15` → ±$0.015-0.016 per post. Di-scrape sekali per **post unik** (bukan per follower/repost event), jadi total biaya terkendali.
- **Bukan prioritas tinggi**: tidak sensitif waktu dan bukan fungsi inti — boleh berjalan lebih lambat/dijeda saat kuota Apify ketat, tanpa mengganggu scraping repost (F2) yang jadi prioritas utama (FR-11.9).
- **Free tier cap**: 15 komentar/post adalah batas riil tanpa billing — desain `get_community_sentiment_pulse` dan tool lain sudah mengasumsikan sampel terbatas ini, bukan komentar lengkap per post.

## 8. Batasan & Risiko

- Actor dikelola komunitas (bukan first-party Apify) — cek status aktifnya sebelum bergantung penuh.
- Post yang sudah dihapus, diprivat, atau komentarnya dimatikan pemiliknya akan gagal di-scrape — diterima sebagai `comments_status = 'failed'`, bukan dikejar terus.
- Menyertakan caption di prompt rangkuman berisiko membuat model cuma merangkum ulang caption alih-alih benar-benar merangkum komentar — prompt sudah diarahkan fokus ke komentar, tapi tetap perlu dicek kualitasnya di beberapa sampel awal.
- Reply/nested comment tidak di-scrape di versi ini — out of scope untuk sekarang.
- `get_community_sentiment_pulse` berbasis sampel (bukan seluruh data) — jangan sampai dipakai model untuk klaim statistik presisi; sudah ditandai eksplisit di deskripsi tool & `note` hasil.
- **Engagement-bait comments** (pola caption "komen X nanti aku kirim link", menghasilkan puluhan komentar nyaris identik) difilter dari rangkuman lewat deteksi duplikat (FR-11.10), bukan daftar frasa spesifik — threshold `dupThreshold = 3` adalah nilai awal, boleh disetel ulang kalau di uji nyata ternyata kurang/terlalu agresif. Kalau SEMUA komentar sebuah post ternyata bait, `comment_summary` tetap `null` (bukan dipaksa merangkum sesuatu yang tidak ada substansinya).

## 9. Kriteria Selesai (Definition of Done)

- [x] Tabel `comments` + kolom `posts.comments_status`/`comment_summary` terpasang
- [x] `scrapeCommentsForPost()` berjalan via infrastruktur rotasi multi API-key yang sama dengan F2/F3
- [x] Post `comment_count = 0` otomatis `skipped` tanpa memanggil actor
- [x] Komentar diurutkan ulang manual di kode (bukan mengandalkan actor) sebelum dipakai rangkuman
- [x] `comment_summary` ikut memicu re-embed (`embedding_status = pending`)
- [x] Kelima tool (`get_community_sentiment_pulse`, `detect_recurring_questions`, `search_comments`, `get_most_liked_comments_overall`, `get_comment_to_repost_ratio`) terdaftar di `CHATBOT_TOOLS` dan berfungsi
- [x] `get_post_detail` (kalau sudah ada) ikut membawa `commentSummary` dan top comments
- [x] `filterLowSignalComments()` terpasang di alur rangkuman — uji pakai post bertipe "komen X nanti aku kirim link", pastikan komentar duplikat (mis. "Alasanku" berulang) tidak muncul di `comment_summary`, tapi tetap tersimpan utuh di tabel `comments`
- [x] Uji manual: post dengan komentar banyak, post tanpa komentar, post yang sudah dihapus/private
- [x] Uji manual: tanya chatbot pertanyaan yang relevan ke tiap tool baru, pastikan tool yang tepat terpanggil (terutama bedakan `get_community_sentiment_pulse` vs `get_topic_distribution` — kualitatif-sampel vs kuantitatif-whole-database)
