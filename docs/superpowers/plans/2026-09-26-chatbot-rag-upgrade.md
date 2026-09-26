# Chatbot RAG Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade RepostInsight's chatbot RAG (`/api/chat`) to reason multi-step across tools, add an accurate whole-database topic-distribution tool (fixing a sampling-bias bug in "topik paling sering" answers), add a post drill-down tool, fix a wrong recency metric, and render markdown (incl. tables) in the chat UI.

**Architecture:** Existing 4-tool chat orchestrator (`apps/web/app/api/chat/route.ts`) already loops tool-calling rounds — extend it (6 iterations, temperature 0.4, full history, rewritten system prompt) and add 2 new tools (`get_post_detail`, `get_topic_distribution`) to the existing tools file. Topic distribution requires new DB state: a `hashtag_topics` lookup table populated by a new resumable worker batch-loop (`reclassifyHashtagTopics`) that classifies hashtags into semantic topics via the existing 9Router LLM client, plus a `mv_topic_distribution` materialized view aggregating from it. Chat UI gets `react-markdown` + `remark-gfm`.

**Tech Stack:** Next.js API routes, Prisma + Postgres/pgvector, raw SQL for materialized views (existing pattern), 9Router (`http://127.0.0.1:20128/v1`, model `ag/gemini-3-flash` via `NINEROUTER_*` env vars), Node.js worker (`tsx`, no new deps needed there), `react-markdown` + `remark-gfm` (new web deps).

**Spec:** `docs/PROMPT-UPGRADE-CHATBOT.md` (task brief — standalone, not part of `docs/SRS.md`). Also read `docs/SRS.md` §3 F6, §4 (data model conventions) before touching schema.

## Global Constraints

- Bahasa UI/prompt/pesan error: Bahasa Indonesia (project convention, all docs).
- Tidak ada automated testing/CI — verifikasi setiap task secara manual (dev server, psql/Prisma Studio, browser). Jangan menulis file test.
- Jangan ubah pipeline scraping/embedding yang sudah berjalan di luar yang diminta di sini (hanya boleh menambah refresh MV baru & 1 loop worker baru).
- Jangan hapus atau ganti nama 4 tool yang sudah ada (`semantic_search`, `query_aggregate`, `analyze_topics`, `render_chart`) — hanya boleh menambah tool baru dan menyempurnakan deskripsi/implementasi internalnya.
- Status enum & nama tabel/kolom: `snake_case` di DB (via `@map`), `camelCase`/`PascalCase` di Prisma/TS (lihat `docs/PROJECT_STRUCTURE.md` §5).
- Model/base URL LLM dibaca dari env var, tidak boleh hardcode kredensial (lihat `.env.example`).
- Materialized view baru butuh unique index agar bisa `REFRESH MATERIALIZED VIEW CONCURRENTLY` (pola yang sudah dipakai `mv_top_reposted_accounts`, `mv_trending_hashtags`, `mv_repost_activity_timeline`).
- **Package manager is npm workspaces, NOT pnpm** — despite `docs/PROJECT_STRUCTURE.md` §2 documenting pnpm, this repo's actual root `package.json` uses `"workspaces": ["packages/*", "apps/*"]` + `package-lock.json` (confirmed: no `pnpm-workspace.yaml`, no `pnpm-lock.yaml`). This is an accepted deviation already anticipated by that doc ("bisa diganti npm/yarn sesuai preferensi"). Any `pnpm --filter X ...` command below is WRONG for this repo — use the npm equivalent: `npm --workspace=@repostinsight/<pkg> run <script>` for defined scripts, or `npx <bin>` run from inside the relevant package directory for one-off CLI invocations (avoids `npm exec`'s flag-forwarding ambiguity, which caused `prisma migrate dev --name X` to hang on an interactive prompt when tried through `npm --workspace=... exec ...`).
- Setelah menambah kolom/tabel Prisma, refleksikan juga di `docs/SRS.md` §4 dan `docs/PROJECT_STRUCTURE.md` §3 (kedua tempat, sesuai `CLAUDE.md`) — dilakukan di Task 1.

---

## Task 1: Prisma schema + migration — `hashtag_topics` table + `mv_topic_distribution` view

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create (generated then hand-edited): `packages/db/prisma/migrations/<timestamp>_hashtag_topics/migration.sql`
- Modify: `docs/SRS.md` (§4 data model — add table def)
- Modify: `docs/PROJECT_STRUCTURE.md` (§3 Prisma schema — add model)

**Interfaces:**
- Produces: Prisma model `HashtagTopic` → table `hashtag_topics(hashtag TEXT PK, topic_label TEXT, updated_at TIMESTAMPTZ)`; materialized view `mv_topic_distribution(topic_label, usage_count, unique_reposters_count, unique_post_count)` with unique index on `topic_label`. Later tasks (`apps/web/lib/tools/index.ts`, `apps/worker/src/hashtagTopics.ts`) read/write both via `prisma.hashtagTopic` and raw SQL against `mv_topic_distribution`.

- [ ] **Step 1: Add `HashtagTopic` model to schema.prisma**

Open `packages/db/prisma/schema.prisma` and insert this model after the `ChatMessage` model (end of file):

```prisma
model HashtagTopic {
  hashtag    String   @id
  topicLabel String   @map("topic_label")
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@index([topicLabel])
  @@map("hashtag_topics")
}
```

(Note: `@db.Timestamptz(3)` is required here to match every other timestamp column in the schema — `docs/SRS.md`'s own documentation of this table already says `timestamptz`, so the Prisma model must match or the generated migration will create a plain `timestamp(3) without time zone` column that contradicts the docs.)

- [ ] **Step 2: Generate the migration scaffold**

Run from repo root (this repo uses npm workspaces — `cd` into the package and run prisma's CLI directly with `npx`, rather than `npm --workspace=... exec ...`, which mishandles the `--name` flag and hangs on prisma's interactive migration-name prompt):

```bash
cd packages/db && npx prisma migrate dev --name hashtag_topics && cd ../..
```

This creates `packages/db/prisma/migrations/<timestamp>_hashtag_topics/migration.sql` containing the `CREATE TABLE "hashtag_topics" (...)` + index DDL generated from the schema diff, and applies it to your local Postgres.

- [ ] **Step 3: Hand-append the materialized view SQL to the generated migration**

Open the generated `packages/db/prisma/migrations/<timestamp>_hashtag_topics/migration.sql` file and append this to the end (same file, same convention as `packages/db/prisma/migrations/1_materialized_views/migration.sql`):

```sql
-- Materialized View: Topic Distribution (kelompok semantik dari hashtag, lihat hashtag_topics)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_topic_distribution AS
SELECT
  ht.topic_label,
  COUNT(*)::int AS usage_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_reposters_count,
  COUNT(DISTINCT p.id)::int AS unique_post_count
FROM posts p
CROSS JOIN LATERAL unnest(p.hashtags) AS tag
JOIN hashtag_topics ht ON ht.hashtag = tag
JOIN repost_events re ON re.post_id = p.id
GROUP BY ht.topic_label
ORDER BY usage_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_topic_distribution_label ON mv_topic_distribution(topic_label);
```

- [ ] **Step 4: Apply the appended SQL**

The materialized view DDL wasn't part of what `prisma migrate dev` already applied in Step 2 (you added it to the migration file by hand afterward, for history/documentation purposes only). Do NOT re-run the whole `migration.sql` file through `prisma db execute` — it would re-issue the `CREATE TABLE "hashtag_topics"` statement Step 2 already applied, and that statement has no `IF NOT EXISTS` guard (Prisma-generated DDL never adds one), so it will error immediately and never reach the view DDL. Instead, apply ONLY the two new statements you appended in Step 3 directly:

```bash
docker compose exec db psql -U postgres -d repostinsight -c "
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_topic_distribution AS
SELECT
  ht.topic_label,
  COUNT(*)::int AS usage_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_reposters_count,
  COUNT(DISTINCT p.id)::int AS unique_post_count
FROM posts p
CROSS JOIN LATERAL unnest(p.hashtags) AS tag
JOIN hashtag_topics ht ON ht.hashtag = tag
JOIN repost_events re ON re.post_id = p.id
GROUP BY ht.topic_label
ORDER BY usage_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_topic_distribution_label ON mv_topic_distribution(topic_label);
"
```

- [ ] **Step 5: Verify manually**

```bash
docker compose exec db psql -U postgres -d repostinsight -c "\d hashtag_topics"
docker compose exec db psql -U postgres -d repostinsight -c "\d mv_topic_distribution"
docker compose exec db psql -U postgres -d repostinsight -c "SELECT COUNT(*) FROM mv_topic_distribution;"
```

Expect: `hashtag_topics` table exists with columns `hashtag`, `topic_label`, `updated_at`; `mv_topic_distribution` exists (will show `0` rows for now since `hashtag_topics` is empty — that's expected, Task 3 populates it).

- [ ] **Step 6: Document in SRS.md and PROJECT_STRUCTURE.md**

In `docs/SRS.md` §4 (Data Model), add after the `ChatMessage` table SQL block:

```sql
-- Kelompok semantik hashtag (lihat get_topic_distribution di F6, docs/PROMPT-UPGRADE-CHATBOT.md)
CREATE TABLE hashtag_topics (
  hashtag     text PRIMARY KEY,
  topic_label text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

In `docs/PROJECT_STRUCTURE.md` §3 (Prisma Schema Lengkap), add the same `model HashtagTopic { ... }` block from Step 1 after the `ChatMessage` model.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations docs/SRS.md docs/PROJECT_STRUCTURE.md
git commit -m "feat: tambah tabel hashtag_topics dan mv_topic_distribution"
```

---

## Task 2: Fix recency bias + add `get_topic_distribution` + `get_post_detail` tools

**Files:**
- Modify: `apps/web/lib/tools/index.ts`

**Interfaces:**
- Consumes: `prisma` singleton from `@repostinsight/db` (already imported at top of file); `hashtag_topics`/`mv_topic_distribution` from Task 1.
- Produces: `executeGetTopicDistribution(topN?: number)`, `executeGetPostDetail(postId: string)` — both exported; both added as entries to the exported `CHATBOT_TOOLS` array (consumed by Task 4's `route.ts`).

- [ ] **Step 1: Fix recency basis in `executeSemanticSearch`**

The current global time-range query and per-candidate recency both use `posts.taken_at` (original IG upload date), but recency should reflect "kapan data ini di-scrape" (`repost_events.scraped_at`). In `apps/web/lib/tools/index.ts`, replace this block (lines 45-53):

```ts
    // 2. Rentang waktu GLOBAL seluruh database (bukan hanya dari kandidat window)
    const tsRange: any[] = await prisma.$queryRawUnsafe(
      `SELECT EXTRACT(EPOCH FROM MIN(taken_at))::bigint AS min_ts,
              EXTRACT(EPOCH FROM MAX(taken_at))::bigint AS max_ts
       FROM posts WHERE taken_at IS NOT NULL AND embedding IS NOT NULL;`
    );
    const globalMinTs = Number(tsRange[0]?.min_ts ?? 0);
    const globalMaxTs = Number(tsRange[0]?.max_ts ?? 0);
    const globalTsRange = globalMaxTs - globalMinTs || 1;
```

with:

```ts
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
```

- [ ] **Step 2: Bring `MAX(scraped_at)` per post into the candidate query**

Replace the candidate query (currently lines 55-81):

```ts
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
```

with (adds `MAX(re.scraped_at) AS last_scraped_at`):

```ts
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
```

- [ ] **Step 3: Use `last_scraped_at` instead of `taken_at` in the re-rank step**

Replace the re-rank block (currently lines 87-96):

```ts
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
```

with:

```ts
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
```

(The `queryNote` and per-result mapping later in the function stay as-is — `takenAt` is still returned in the output for display purposes, only the *ranking* basis changes.)

- [ ] **Step 4: Add `executeGetTopicDistribution`**

Insert this new exported function right before `executeRenderChart` (i.e. after `executeAnalyzeTopics` ends, before the `/** Tool 4: Render Chart Generator */` comment):

```ts
/**
 * Tool: Distribusi Topik (semantik, whole-database) — PROMPT-UPGRADE-CHATBOT.md item 7
 * Berbeda dari analyze_topics (per-hashtag literal): ini mengelompokkan hashtag jadi TOPIK
 * lewat tabel hashtag_topics (diisi worker via reclassifyHashtagTopics), akurat untuk
 * SELURUH database — bukan sampel semantic_search.
 */
export async function executeGetTopicDistribution(topN: number = 10) {
  const safeTopN = Math.max(1, Math.min(30, topN));

  const allRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT topic_label, usage_count, unique_reposters_count, unique_post_count
     FROM mv_topic_distribution
     ORDER BY usage_count DESC;`
  );

  if (allRows.length === 0) {
    return {
      source: "mv_topic_distribution",
      note: "Belum ada topik terklasifikasi (worker belum selesai memproses backlog hashtag).",
      totalTopicsFound: 0,
      topics: [],
    };
  }

  const globalTotal = allRows.reduce((s, r) => s + Number(r.usage_count), 0) || 1;
  const topRows = allRows.slice(0, safeTopN);

  return {
    source: "mv_topic_distribution",
    note: "Distribusi TOPIK (kelompok semantik beberapa hashtag terkait), dihitung dari SELURUH database — bukan sampel. percentageOfAll = proporsi dari total SEMUA topik. Topik 'Lainnya' berisi hashtag generik/algoritmik (fyp, viral, reels, dst).",
    totalTopicsFound: allRows.length,
    globalTotalUsage: globalTotal,
    topics: topRows.map((r) => ({
      topicLabel: r.topic_label,
      occurrenceCount: Number(r.usage_count),
      uniquePostCount: Number(r.unique_post_count),
      uniqueReposters: Number(r.unique_reposters_count),
      percentageOfAll: parseFloat(((Number(r.usage_count) / globalTotal) * 100).toFixed(2)),
    })),
  };
}
```

- [ ] **Step 5: Add `executeGetPostDetail`**

Insert this new exported function right after `executeGetTopicDistribution` (still before `executeRenderChart`):

```ts
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
    commentSummary: null,
    topComments: [] as { text: string; likeCount: number }[],
    repostedBy: post.repostEvents.map((r) => r.followerUsername),
    repostCount: post.repostEvents.length,
  };
}
```

- [ ] **Step 6: Register both new tools in `CHATBOT_TOOLS`, and clarify `analyze_topics`'s description**

In the `CHATBOT_TOOLS` array, first replace the `analyze_topics` entry's `description` field (keep `name` and `parameters` unchanged) — old:

```ts
      description:
        "Menghitung distribusi topik/tema nyata dari SELURUH database berdasarkan hashtag yang terkandung di postingan yang di-repost. Gunakan tool ini (bukan semantic_search) setiap kali pengguna bertanya: 'topik apa paling sering dibahas', 'tema dominan', 'distribusi konten', 'proporsi topik', 'kategori konten terbanyak', atau meminta grafik distribusi topik/niche.",
```

new:

```ts
      description:
        "Menghitung distribusi HASHTAG LITERAL (per-tag, bukan topik semantik) dari seluruh database. Untuk pertanyaan 'topik/tema apa paling sering dibahas' atau 'distribusi topik', gunakan 'get_topic_distribution' (topik semantik yang mengelompokkan beberapa hashtag terkait), BUKAN tool ini dan BUKAN semantic_search. Tool ini cocok jika pengguna secara spesifik bertanya soal hashtag literal (bukan topik/tema).",
```

Then add two new entries at the end of the `CHATBOT_TOOLS` array (after the `render_chart` entry, so the array now has 6 entries total):

```ts
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
];
```

(Note: the closing `];` above replaces the original closing `];` of the array — i.e. insert these two objects as new array elements before the final `];`, don't duplicate it.)

- [ ] **Step 7: Verify manually**

Start the web app (`npm run dev` from repo root) and in a scratch Node REPL or a temporary test route, or simply via `npx tsx` run from inside `apps/web` (`cd apps/web && npx tsx <script>.ts`), call:

```ts
import { executeGetPostDetail, executeGetTopicDistribution } from "./apps/web/lib/tools";
// pick a real post id from: SELECT id FROM posts LIMIT 1;
executeGetPostDetail("<a real post id>").then(console.log);
executeGetTopicDistribution(5).then(console.log); // expect totalTopicsFound: 0 until Task 3 populates hashtag_topics
```

Expect: `executeGetPostDetail` returns `found: true` with `commentSummary: null, topComments: []`; `executeGetTopicDistribution` returns `topics: []` (empty, since `hashtag_topics` isn't populated yet — Task 3 fixes that). No exceptions thrown.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/tools/index.ts
git commit -m "feat: fix recency basis di semantic_search, tambah get_topic_distribution & get_post_detail"
```

---

## Task 3: Worker — `reclassifyHashtagTopics()` resumable batch loop

**Files:**
- Modify: `apps/worker/src/visualDescriber.ts` (export existing private helper)
- Create: `apps/worker/src/hashtagTopics.ts`
- Modify: `apps/worker/src/scrapeLoop.ts` (add `mv_topic_distribution` to the MV refresh block)
- Modify: `apps/worker/src/index.ts` (wire up the new loop)
- Create: `apps/worker/src/reclassifyOnce.ts` (standalone one-shot entrypoint — lets the project owner populate `hashtag_topics` immediately without starting the full worker/scraping/embedding loops, useful while the dataset is still small)
- Modify: `apps/worker/package.json` (add an npm script to run the one-shot entrypoint)

**Interfaces:**
- Consumes: `prisma.hashtagTopic` (Task 1), `prisma` singleton, `NINEROUTER_*` env vars (existing pattern from `visualDescriber.ts`).
- Produces: `reclassifyHashtagTopics(): Promise<void>` exported from `apps/worker/src/hashtagTopics.ts`, called once at worker startup and then every 24h from `apps/worker/src/index.ts`, AND on-demand via `npm --workspace=@repostinsight/worker run reclassify-hashtags` (`apps/worker/src/reclassifyOnce.ts`) without touching `startScrapeLoop`/`startEmbeddingLoop`.

- [ ] **Step 1: Export the existing `callChatCompletion` helper for reuse**

In `apps/worker/src/visualDescriber.ts`, change the function signature (currently, inside the "9Router API helpers" section):

```ts
async function callChatCompletion(prompt: string): Promise<string> {
```

to:

```ts
export async function callChatCompletion(prompt: string): Promise<string> {
```

(Only this one keyword changes — nothing else in the file changes.)

- [ ] **Step 2: Create `apps/worker/src/hashtagTopics.ts`**

```ts
import { prisma } from "@repostinsight/db";
import { callChatCompletion } from "./visualDescriber";

const BATCH_SIZE = 60;

const GENERIC_HASHTAGS = new Set([
  "fyp",
  "fypage",
  "foryou",
  "foryoupage",
  "viral",
  "viralvideo",
  "reels",
  "reelsinstagram",
  "explore",
  "explorepage",
  "trending",
  "instagood",
  "instadaily",
]);

interface UnclassifiedRow {
  tag: string;
  usage_count: number;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseClassificationResponse(raw: string, tags: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const cleaned = stripCodeFence(raw);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Tidak ditemukan blok JSON pada respons LLM.");
    }
    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    for (const tag of tags) {
      const label = parsed[tag];
      result[tag] = typeof label === "string" && label.trim() ? label.trim() : "Lainnya";
    }
  } catch (err) {
    console.warn(
      "[HashtagTopics] Gagal parse respons klasifikasi, fallback seluruh batch ke 'Lainnya':",
      (err as Error).message
    );
    for (const tag of tags) {
      result[tag] = "Lainnya";
    }
  }
  return result;
}

function buildClassificationPrompt(tags: string[], existingLabels: string[]): string {
  const labelSection =
    existingLabels.length > 0
      ? `Berikut daftar topic_label yang SUDAH ada — PAKAI ULANG label ini jika hashtag baru cocok maknanya, JANGAN membuat label baru yang maknanya sama:\n${existingLabels
          .map((l) => `- ${l}`)
          .join("\n")}\n\n`
      : "";

  return (
    `Kamu adalah pengklasifikasi topik hashtag Instagram Bahasa Indonesia untuk sistem riset konten dakwah/komunitas.\n\n` +
    labelSection +
    `Klasifikasikan setiap hashtag berikut ke SATU topic_label singkat (2-4 kata, Bahasa Indonesia, Title Case, misal "Parenting & Keluarga", "Sedekah & Kedermawanan"):\n` +
    tags.map((t) => `- ${t}`).join("\n") +
    `\n\nBalas HANYA dengan satu JSON object valid, key = hashtag PERSIS seperti tertulis di atas (tanpa tanda pagar), value = topic_label. Jangan sertakan penjelasan atau teks lain di luar JSON.`
  );
}

async function classifyHashtagBatch(
  tags: string[],
  existingLabels: string[]
): Promise<Record<string, string>> {
  const genericAssigned: Record<string, string> = {};
  const toClassify: string[] = [];

  for (const tag of tags) {
    if (GENERIC_HASHTAGS.has(tag)) {
      genericAssigned[tag] = "Lainnya";
    } else {
      toClassify.push(tag);
    }
  }

  if (toClassify.length === 0) {
    return genericAssigned;
  }

  const prompt = buildClassificationPrompt(toClassify, existingLabels);
  const raw = await callChatCompletion(prompt);
  const classified = parseClassificationResponse(raw, toClassify);

  return { ...genericAssigned, ...classified };
}

async function refreshTopicDistributionView(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_topic_distribution;`);
  } catch {
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_topic_distribution;`);
    } catch (err) {
      console.warn("[HashtagTopics] Gagal merefresh mv_topic_distribution:", err);
    }
  }
}

/**
 * Mengklasifikasikan seluruh backlog hashtag yang belum punya topic_label, batch demi batch
 * (self-resuming — aman dipanggil ulang kapan saja: backlog besar pertama kali, atau trickle
 * harian dari scraping berikutnya). Setiap batch menuliskan label untuk SEMUA tag di batch itu
 * (termasuk fallback "Lainnya" jika parsing gagal), sehingga loop dijamin maju tiap iterasi.
 */
export async function reclassifyHashtagTopics(): Promise<void> {
  let totalClassified = 0;

  while (true) {
    const existingLabelRows: { topic_label: string }[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT topic_label FROM hashtag_topics ORDER BY topic_label ASC;`
    );
    const existingLabels = existingLabelRows.map((r) => r.topic_label);

    const unclassified: UnclassifiedRow[] = await prisma.$queryRawUnsafe(
      `SELECT tag, COUNT(*)::int AS usage_count
       FROM posts p
       CROSS JOIN LATERAL unnest(p.hashtags) AS tag
       LEFT JOIN hashtag_topics ht ON ht.hashtag = tag
       WHERE ht.hashtag IS NULL AND tag IS NOT NULL AND tag != ''
       GROUP BY tag
       ORDER BY usage_count DESC
       LIMIT $1;`,
      BATCH_SIZE
    );

    if (unclassified.length === 0) {
      break;
    }

    const tags = unclassified.map((r) => r.tag);
    console.log(`[HashtagTopics] Mengklasifikasi batch ${tags.length} hashtag...`);

    try {
      const classification = await classifyHashtagBatch(tags, existingLabels);

      await prisma.$transaction(
        Object.entries(classification).map(([hashtag, topicLabel]) =>
          prisma.hashtagTopic.upsert({
            where: { hashtag },
            create: { hashtag, topicLabel },
            update: { topicLabel },
          })
        )
      );

      totalClassified += tags.length;
      console.log(
        `[HashtagTopics] Batch selesai: ${tags.length} hashtag terklasifikasi (total sesi ini: ${totalClassified}).`
      );
    } catch (err) {
      console.error(
        "[HashtagTopics] Gagal mengklasifikasi batch, akan dicoba lagi di siklus berikutnya:",
        err
      );
      break;
    }
  }

  if (totalClassified > 0) {
    await refreshTopicDistributionView();
  }
}
```

- [ ] **Step 3: Add `mv_topic_distribution` to the scrapeLoop refresh block**

In `apps/worker/src/scrapeLoop.ts`, replace the MV refresh block at the end of `saveScrapedReposts`:

```ts
  // Refresh materialized views so dashboard & chatbot see new aggregates
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_reposted_accounts;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_hashtags;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_repost_activity_timeline;`);
  } catch {
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_top_reposted_accounts;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_trending_hashtags;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_repost_activity_timeline;`);
    } catch (err) {
      console.warn("[ScrapeLoop] Gagal merefresh materialized views:", err);
    }
  }
```

with:

```ts
  // Refresh materialized views so dashboard & chatbot see new aggregates
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_reposted_accounts;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_hashtags;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_repost_activity_timeline;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_topic_distribution;`);
  } catch {
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_top_reposted_accounts;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_trending_hashtags;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_repost_activity_timeline;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_topic_distribution;`);
    } catch (err) {
      console.warn("[ScrapeLoop] Gagal merefresh materialized views:", err);
    }
  }
```

- [ ] **Step 4: Wire up the loop in `apps/worker/src/index.ts`**

Add the import near the other worker imports:

```ts
import { OllamaEmbeddingService } from "./ollamaClient";
import { startEmbeddingLoop } from "./embeddingLoop";
```

becomes:

```ts
import { OllamaEmbeddingService } from "./ollamaClient";
import { startEmbeddingLoop } from "./embeddingLoop";
import { reclassifyHashtagTopics } from "./hashtagTopics";
```

Add this constant and function before `async function main()`:

```ts
const HASHTAG_RECLASSIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 jam

/**
 * Menuntaskan backlog klasifikasi topik hashtag saat startup, lalu mengulang tiap 24 jam
 * untuk menangkap hashtag baru dari scraping berikutnya (PROMPT-UPGRADE-CHATBOT.md item 7).
 */
async function startHashtagTopicLoop(shouldStopRef: { stop: boolean }) {
  console.log("[Worker] Memulai loop klasifikasi topik hashtag...");
  while (!shouldStopRef.stop) {
    try {
      await reclassifyHashtagTopics();
    } catch (err) {
      console.error("[Worker] Gagal menjalankan reclassifyHashtagTopics:", err);
    }

    const checkIntervalMs = 60_000;
    let waited = 0;
    while (waited < HASHTAG_RECLASSIFY_INTERVAL_MS && !shouldStopRef.stop) {
      await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
      waited += checkIntervalMs;
    }
  }
}
```

Then update the `Promise.all` call inside `main()`:

```ts
  // Run both scraping loop and embedding pipeline concurrently
  await Promise.all([
    startScrapeLoop(getActiveApifyService, shouldStopRef),
    startEmbeddingLoop(embeddingService, shouldStopRef),
  ]);
```

becomes:

```ts
  // Run scraping loop, embedding pipeline, and hashtag topic classification concurrently
  await Promise.all([
    startScrapeLoop(getActiveApifyService, shouldStopRef),
    startEmbeddingLoop(embeddingService, shouldStopRef),
    startHashtagTopicLoop(shouldStopRef),
  ]);
```

- [ ] **Step 5: Standalone one-shot entrypoint (`apps/worker/src/reclassifyOnce.ts`)**

The project owner wants to populate `hashtag_topics` and see chatbot results immediately, while the dataset is still small (hundreds of reposts) — without starting the full worker (`main()` in `index.ts` also runs `startScrapeLoop`, which will start dispatching real Apify scrape runs against pending followers and burn API quota, and `startEmbeddingLoop`). Add a separate, minimal entrypoint that does ONLY the hashtag classification, once, then exits.

Create `apps/worker/src/reclassifyOnce.ts`:

```ts
import path from "path";
import dotenv from "dotenv";

// Same env-loading order as index.ts: worker .env first, then root .env with override
dotenv.config();
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnvPath, override: true });

import { reclassifyHashtagTopics } from "./hashtagTopics";

reclassifyHashtagTopics()
  .then(() => {
    console.log("[ReclassifyOnce] Selesai — backlog hashtag telah diklasifikasi.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[ReclassifyOnce] Gagal:", err);
    process.exit(1);
  });
```

(This file intentionally mirrors `index.ts`'s dotenv-loading lines exactly — keep the same relative path `"../../.env"` so env resolution behaves identically to the main worker entrypoint. Do not import `scrapeLoop.ts` or `embeddingLoop.ts` here — that's the whole point of this file.)

In `apps/worker/package.json`, add a new script alongside the existing `"start"`/`"dev"` scripts (open the file first to match its exact existing script style — same runner, e.g. `tsx`, as the other scripts use):

```json
"reclassify-hashtags": "tsx src/reclassifyOnce.ts"
```

- [ ] **Step 6: Verify manually**

Quick path (recommended while the dataset is small — does NOT start scraping/embedding):

```bash
npm --workspace=@repostinsight/worker run reclassify-hashtags
```

Watch the logs for `[HashtagTopics] Mengklasifikasi batch ...` / `Batch selesai` lines, ending with `[ReclassifyOnce] Selesai`. Then run:

```bash
docker compose exec db psql -U postgres -d repostinsight -c "SELECT COUNT(*) FROM mv_trending_hashtags WHERE tag NOT IN (SELECT hashtag FROM hashtag_topics);"
```

Expect: `0` (every hashtag that appears in `mv_trending_hashtags` now has a `hashtag_topics` row). Then:

```bash
docker compose exec db psql -U postgres -d repostinsight -c "SELECT topic_label, usage_count FROM mv_topic_distribution ORDER BY usage_count DESC LIMIT 10;"
docker compose exec db psql -U postgres -d repostinsight -c "SELECT hashtag FROM hashtag_topics WHERE topic_label != 'Lainnya' AND hashtag IN ('fyp','viral','reels');"
```

Expect: sensible topic labels with reasonable counts; the second query returns 0 rows (generic tags all landed in "Lainnya", not real topics).

Full-integration alternative (optional, not required for this task's sign-off): start the full worker (`npm run worker` from repo root) and confirm `[HashtagTopics]` batches also run automatically at startup alongside scraping/embedding, then re-run the same two verification queries above.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/visualDescriber.ts apps/worker/src/hashtagTopics.ts apps/worker/src/scrapeLoop.ts apps/worker/src/index.ts apps/worker/src/reclassifyOnce.ts apps/worker/package.json
git commit -m "feat: worker reclassifyHashtagTopics — klasifikasi topik hashtag resumable + entrypoint standalone"
```

---

## Task 4: `/api/chat` orchestrator — loop to 6, temperature, full history, new system prompt, dispatch new tools

**Files:**
- Modify: `apps/web/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `executeGetTopicDistribution`, `executeGetPostDetail` from Task 2 (`@/lib/tools`); `CHATBOT_TOOLS` (now 6 entries, Task 2).

- [ ] **Step 1: Import the two new tool functions**

Replace the import block:

```ts
import {
  CHATBOT_TOOLS,
  executeSemanticSearch,
  executeQueryAggregate,
  executeAnalyzeTopics,
  executeRenderChart,
} from "@/lib/tools";
```

with:

```ts
import {
  CHATBOT_TOOLS,
  executeSemanticSearch,
  executeQueryAggregate,
  executeAnalyzeTopics,
  executeRenderChart,
  executeGetTopicDistribution,
  executeGetPostDetail,
} from "@/lib/tools";
```

- [ ] **Step 2: Fetch full conversation history instead of the last 10**

Replace:

```ts
    // 2. Fetch recent conversation history
    const rawHistory = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    rawHistory.reverse();
```

with:

```ts
    // 2. Fetch FULL conversation history — pertanyaan lanjutan butuh konteks percakapan penuh,
    //    bukan hanya beberapa pesan terakhir (PROMPT-UPGRADE-CHATBOT.md item 4)
    const rawHistory = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "asc" },
    });
```

(Note: `.reverse()` is removed since we now query in ascending order directly, so `rawHistory` is already chronological.)

- [ ] **Step 3: Rewrite the system prompt**

Replace the entire `role: "system"` content string (currently lines 223-252, the multi-line template literal) with:

```ts
        content: `Kamu adalah asisten analitik RepostInsight — database berisi postingan Instagram yang di-repost followers @ynsurabaya, lengkap dengan caption, hashtag, deskripsi visual (hasil analisis AI dari gambar/video), dan siapa saja yang me-repost tiap post. Tujuanmu: bantu evaluasi konten, ide konten baru, riset kompetitor.

KONTEKS DATABASE:
- followers: akun Instagram yang di-scrape (status: done/pending/in_progress/failed)
- posts: konten Instagram unik yang di-repost (caption, hashtags, media_type, like_count, play_count, taken_at, visual_description)
- repost_events: mencatat follower mana me-repost post mana, dan kapan data itu di-scrape (scraped_at)
- hashtag_topics / mv_topic_distribution: pengelompokan semantik hashtag menjadi topik yang lebih bermakna (dihitung dari SELURUH database, bukan sampel)

CARA BERPIKIR SEBELUM MENJAWAB:
1. Kalau pertanyaan ambigu dan interpretasinya bisa sangat berbeda hasilnya, tanya balik dulu — jangan menebak.
2. Pertanyaan kompleks sering butuh LEBIH DARI SATU tool berurutan (misal get_topic_distribution dulu untuk gambaran besar, baru semantic_search untuk mendalami topik spesifik yang muncul, baru get_post_detail untuk contoh konkret satu post).
3. Setelah dapat hasil tool, nilai: sudah cukup untuk jawaban yang benar-benar berguna, atau perlu tool lagi? Jangan terburu-buru menjawab dengan data yang tanggung.
4. Kalau hasil kosong/tidak relevan, katakan terus terang — jangan mengarang angka atau contoh yang tidak benar-benar ada di hasil tool.

ROUTING TOOL — IKUTI DENGAN TEPAT:
1. ISI konten, tema narasi, dalil, contoh postingan spesifik → semantic_search
2. Pertanyaan "topik/tema apa yang PALING SERING/DOMINAN dibahas", distribusi topik, proporsi niche → WAJIB get_topic_distribution. JANGAN PERNAH pakai semantic_search atau analyze_topics untuk pertanyaan jenis ini — sampelnya tidak representatif dan bisa memunculkan topik langka seolah-olah dominan.
3. Distribusi HASHTAG LITERAL per-tag (bukan topik semantik) → analyze_topics
4. STATISTIK agregat (akun terpopuler, progress scraping, timeline aktivitas) → query_aggregate
5. Ingin melihat DETAIL SATU post spesifik (hasil semantic_search) — caption lengkap, siapa saja yang repost, deskripsi visual, rangkuman komentar jika ada → get_post_detail(postId)
6. GRAFIK/VISUALISASI → PERTAMA panggil tool data yang sesuai, KEMUDIAN render_chart dengan data dari tool tersebut
7. Jangan tampilkan tag XML <tool_call> kepada pengguna

POLA MULTI-TOOL (gunakan sequence ini):
- "topik paling sering dibahas, kasih contoh post-nya" → get_topic_distribution → semantic_search(topik teratas) → get_post_detail(salah satu hasil)
- "grafik topik paling sering" → get_topic_distribution(topN=10) → render_chart(bar, data dari topics[].topicLabel & occurrenceCount)
- "grafik akun terpopuler" → query_aggregate(top_accounts) → render_chart(bar, data dari repostCount)
- "grafik aktivitas repost" → query_aggregate(activity_timeline, limit=30) → render_chart(line/area)

PENGETAHUAN UMUM DI LUAR DATABASE — jangan sempit, tapi tetap jujur soal sumber:
- Untuk pertanyaan ANALITIS (angka, statistik, peringkat, "siapa/apa/berapa banyak"), jawaban WAJIB berbasis hasil tool — dilarang mengarang, ini tidak berubah.
- Untuk pertanyaan INTERPRETATIF/KUALITATIF — makna sebuah topik, konteks sosial/keagamaan/budaya di baliknya, evaluasi kualitas konten, atau ide konten baru — kamu BOLEH dan DIDORONG memakai pengetahuan umummu sendiri (di luar database ini) untuk memperkaya dan memperdalam jawaban. Jangan menahan diri atau menjawab dangkal hanya karena suatu konteks/insight tidak tertulis literal di hasil tool — berpikir dan berinisiatif memberi perspektif tambahan itu justru yang diharapkan.
- WAJIB bedakan sumber secara eksplisit ke pengguna: tandai bagian yang berasal dari data repost mereka sendiri (misal "berdasarkan data repost kamu...") terpisah dari bagian yang murni pengetahuan umum/interpretasi di luar data itu (misal "secara umum, di luar data ini..."). Jangan mencampur keduanya tanpa penanda — pengguna harus selalu bisa membedakan klaim yang terverifikasi dari database vs. yang sifatnya interpretasi/pengetahuan umum darimu.

FORMAT JAWABAN — sesuaikan dengan isi, jangan selalu sama bentuknya:
- Pertanyaan faktual sederhana → jawab langsung 1-3 kalimat.
- Perbandingan beberapa akun/topik → tabel markdown.
- Peringkat/top-N → list bernomor.
- Insight dengan beberapa aspek berbeda → subjudul singkat per aspek.
- Merangkum banyak post/komentar → kelompokkan per tema, jangan daftar mentah.
- Sertakan angka konkret dari hasil tool untuk mendukung klaim (jumlah repost, jumlah follower unik, dst) — hindari kata "banyak"/"sering" tanpa angka pendukung.
- Kalau menyebut visual_description atau rangkuman komentar, ingat itu hasil analisis AI, bukan fakta mentah — sebut sumbernya kalau relevan ("berdasarkan analisis visual AI...").

ATURAN ANTI-HALUSINASI (WAJIB):
- DILARANG mengarang, mengestimasi, atau mengasumsikan angka/persentase tanpa data dari tool.
- Nilai pada render_chart HARUS diambil verbatim dari hasil tool sebelumnya, bukan dari asumsi.
- Jika tidak ada tool yang sesuai, katakan terus terang dan sarankan pertanyaan yang bisa dijawab.

MEMBACA HASIL TOOL:
- semantic_search: repostCount = jumlah followers yang me-repost; visualDescription = deskripsi gambar/video dari AI; combinedScore = gabungan relevansi + kebaruan data (recency dihitung dari kapan data di-scrape, bukan tanggal asli post diunggah)
- get_topic_distribution: percentageOfAll dihitung dari total SEMUA topik terklasifikasi; topik "Lainnya" berisi hashtag generik/algoritmik (fyp, viral, reels, dst) — bukan topik nyata
- analyze_topics: distribusi per-hashtag literal (bukan topik semantik), percentageOfAll dari total SEMUA hashtag
- query_aggregate summary: breakdown status scraping (done/pending/in_progress/failed) dan embeddingCoveragePct
- get_post_detail: commentSummary/topComments bisa bernilai null/kosong jika fitur rangkuman komentar belum tersedia untuk post tersebut — jangan mengarang isinya`,
```

- [ ] **Step 4: Bump the loop to 6 iterations and add `temperature: 0.4`**

Replace:

```ts
    // Loop for tool execution (up to 4 steps to allow multi-tool sequences)
    let currentStep = 0;
    const maxSteps = 4;
```

with:

```ts
    // Loop for tool execution (up to 6 steps to allow deeper multi-tool sequences)
    let currentStep = 0;
    const maxSteps = 6;
```

Replace the fetch body inside the loop:

```ts
        body: JSON.stringify({
          model,
          messages: messagesPayload,
          tools: CHATBOT_TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
```

with:

```ts
        body: JSON.stringify({
          model,
          messages: messagesPayload,
          tools: CHATBOT_TOOLS,
          tool_choice: "auto",
          temperature: 0.4,
          stream: false,
        }),
```

- [ ] **Step 5: Dispatch the two new tools inside the tool-execution loop**

Replace:

```ts
        if (call.name === "semantic_search") {
          toolResult = await executeSemanticSearch(call.args?.query, call.args?.limit);
        } else if (call.name === "query_aggregate") {
          toolResult = await executeQueryAggregate(call.args?.metric, call.args?.limit);
        } else if (call.name === "analyze_topics") {
          toolResult = await executeAnalyzeTopics(call.args?.topN);
        } else if (call.name === "render_chart") {
          toolResult = executeRenderChart(call.args?.chartType, call.args?.title, call.args?.data);
          chartToRender = toolResult;
        }
```

with:

```ts
        if (call.name === "semantic_search") {
          toolResult = await executeSemanticSearch(call.args?.query, call.args?.limit);
        } else if (call.name === "query_aggregate") {
          toolResult = await executeQueryAggregate(call.args?.metric, call.args?.limit);
        } else if (call.name === "analyze_topics") {
          toolResult = await executeAnalyzeTopics(call.args?.topN);
        } else if (call.name === "get_topic_distribution") {
          toolResult = await executeGetTopicDistribution(call.args?.topN);
        } else if (call.name === "get_post_detail") {
          toolResult = await executeGetPostDetail(call.args?.postId);
        } else if (call.name === "render_chart") {
          toolResult = executeRenderChart(call.args?.chartType, call.args?.title, call.args?.data);
          chartToRender = toolResult;
        }
```

- [ ] **Step 6: Verify manually**

Start `npm run dev` (repo root), open `/chat`, and send: `"topik apa yang lagi ramai, kasih contoh post-nya dan siapa yang paling banyak repost"`. Watch the server console / the returned `toolCalls` in the response — expect to see `get_topic_distribution` called (not `semantic_search` first), likely followed by `semantic_search` and/or `get_post_detail` in the same request without you having to ask step-by-step. Also send a follow-up message referencing "itu" (e.g. "bandingkan itu dengan akun lain") and confirm the reply shows it understood the prior context (full history working).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/chat/route.ts
git commit -m "feat: orchestrator chat — loop 6 iterasi, riwayat penuh, system prompt baru, tool baru"
```

---

## Task 5: Chat UI — render markdown (incl. tables)

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/app/chat/page.tsx`

**Interfaces:**
- Consumes: `react-markdown` (default export `ReactMarkdown`), `remark-gfm` (default export `remarkGfm`).

- [ ] **Step 1: Add dependencies**

```bash
npm install react-markdown remark-gfm --workspace=@repostinsight/web
```

This adds `react-markdown` and `remark-gfm` to `apps/web/package.json` `dependencies` (npm rewrites `apps/web/package.json` and the root `package-lock.json` automatically — no manual JSON edit needed).

- [ ] **Step 2: Import in `apps/web/app/chat/page.tsx`**

Add near the top, after the `recharts` import block:

```ts
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
```

- [ ] **Step 3: Render assistant content as markdown, keep user content as plain text**

Replace:

```tsx
                <div className="whitespace-pre-wrap">{msg.content}</div>
```

with:

```tsx
                {msg.role === "user" ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <div className="prose prose-sm prose-slate max-w-none prose-table:text-xs prose-th:px-2 prose-td:px-2 prose-p:my-1.5 prose-headings:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
```

(This uses Tailwind's `prose` utility classes, which are already available since `tailwindcss` is a dependency — no `@tailwindcss/typography` plugin is installed, so if `prose` classes render unstyled, that's fine functionally: `react-markdown` still produces real `<table>`/`<strong>`/`<ul>` elements which browsers render sensibly by default; the `prose` classes are a progressive enhancement, not a requirement. Skip adding the typography plugin — out of scope for this task.)

- [ ] **Step 4: Verify manually**

Start `npm run dev` (repo root), open `/chat`, ask a question that should produce a markdown table (e.g. "bandingkan 3 akun paling sering di-repost dalam bentuk tabel"). Confirm the reply renders as an actual HTML `<table>` (borders/rows visible, not literal `|` pipe characters), and that bold/lists also render correctly. Confirm user messages still display as plain text (no markdown parsing needed there, but harmless either way — plan keeps them plain per the code above).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/app/chat/page.tsx
git commit -m "feat: render markdown (termasuk tabel) di chat UI"
```

---

## Task 6: Full manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Multi-tool chaining without step-by-step prompting**

In `/chat`, ask: `"topik apa yang lagi ramai, kasih contoh post-nya dan siapa yang paling banyak repost"`. Confirm (via the JSON response's `toolCalls`, visible in browser devtools Network tab on the `/api/chat` request) that the model calls `get_topic_distribution` first, then follows up with `semantic_search` and/or `get_post_detail` and/or `query_aggregate` in the same turn, without you having to ask again.

- [ ] **Step 2: `get_topic_distribution` accuracy check**

Pick one topic label returned by the tool, e.g. `"Parenting & Keluarga"`, and cross-check manually:

```bash
docker compose exec db psql -U postgres -d repostinsight -c "
SELECT COUNT(*) FROM posts p
CROSS JOIN LATERAL unnest(p.hashtags) AS tag
JOIN hashtag_topics ht ON ht.hashtag = tag
JOIN repost_events re ON re.post_id = p.id
WHERE ht.topic_label = 'Parenting & Keluarga';"
```

Confirm this count matches the `occurrenceCount` the tool returned for that topic (allowing for drift if new reposts came in since the last MV refresh — refresh and recheck if needed: `docker compose exec db psql -U postgres -d repostinsight -c "REFRESH MATERIALIZED VIEW mv_topic_distribution;"`).

- [ ] **Step 3: Low-occurrence topics don't falsely appear as top-5**

Ask: `"5 topik paling sering dibahas"`. Confirm the returned top-5 topics all have a meaningfully high `percentageOfAll` (not e.g. a topic at <1% appearing above topics with 10%+ share) — this is the bug the brief describes (`semantic_search`'s small sample previously caused this).

- [ ] **Step 4: Generic hashtags don't pollute topics**

Confirm `"fyp"`, `"viral"`, `"reels"` (or whichever generic tags exist in your data) all map to `topic_label = 'Lainnya'` — already checked via SQL in Task 3 Step 5, re-confirm here if data has grown since.

- [ ] **Step 5: Conversation continuity**

Send a first message, then a follow-up that only makes sense with context (e.g. "dari itu, mana yang paling banyak di-repost minggu ini?"). Confirm the reply correctly references the prior turn's topic/results.

- [ ] **Step 6: Markdown table rendering**

Ask for a comparison; confirm the reply renders as a real table in the browser, not raw `| a | b |` text.

- [ ] **Step 7: `get_post_detail` doesn't crash on posts with no comment data**

Ask a question that leads the model to call `get_post_detail` on a real post id; confirm the tool result includes `commentSummary: null, topComments: []` without any 500 error in the `/api/chat` response.

- [ ] **Step 8: Backlog fully classified**

Re-run the check from Task 3 Step 5:

```bash
docker compose exec db psql -U postgres -d repostinsight -c "SELECT COUNT(*) FROM mv_trending_hashtags WHERE tag NOT IN (SELECT hashtag FROM hashtag_topics);"
```

Confirm `0`.

- [ ] **Step 9: Update the task brief's own checklist**

In `docs/PROMPT-UPGRADE-CHATBOT.md`, check off every `- [ ]` under "Kriteria Selesai" and "Kriteria selesai tambahan" that now passes (Steps 1-8 above map directly to those checkboxes).
