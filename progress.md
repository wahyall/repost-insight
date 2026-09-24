# Progress Log

## Session: 2026-09-24

### Initial Setup & Diagnostics
- Node.js (v22.20.0), npm (v10.9.3), Docker Desktop aktif dengan WSL2.
- Data export followers Instagram tersedia di `D:\yukngaji\connections\followers_and_following\followers_1.json` (10.000 followers) dan `followers_2.json`.

---

### Fase 0 — Fondasi (SELESAI)
- Monorepo diinisialisasi: `apps/web`, `apps/worker`, `packages/db`.
- Prisma schema lengkap disetup dengan pgvector, followers, posts, repost_events, apify_api_keys, scrape_control, chat_messages.
- Docker compose Postgres+pgvector (`pgvector/pgvector:pg16`) berhasil dijalankan pada port 5432.
- Migrasi SQL awal `0_init` berhasil dijalankan dan ditandai applied di Prisma.
- Endpoint `POST /api/followers/import` (FR-1.1–1.5) dan `GET /api/followers` (FR-9.1) diimplementasikan dengan find-or-create chunked insert.
- UI `apps/web/app/settings/followers/page.tsx` dibuat dengan upload file, ringkasan metrik, filter, dan tabel follower.
- Pengujian manual & skrip verifikasi berhasil 100%.

---

### Fase 1 — Scraping Engine, Single Key (SELESAI)
- Client Apify actor `data-slayer/instagram-reposts` diimplementasikan (`apps/worker/src/apifyClient.ts`) dengan `maxItems: 20`.
- Scrape worker loop diimplementasikan (`apps/worker/src/scrapeLoop.ts`):
  - Rekonsiliasi start-up otomatis untuk follower `in_progress` (FR-2.3).
  - Kontrol pause/resume terpusat di tabel database `scrape_control` (FR-2.4–2.5).
  - Mekanisme auto-retry eksponensial maksimal 3x sebelum ditandai `failed` permanen (FR-2.7).
- Endpoint scraping control dibuat (`POST /api/scrape-control/pause`, `POST /api/scrape-control/resume`, `GET/PATCH /api/scrape-control`).
- UI kontrol scraping (tombol Jeda/Lanjutkan dan status live engine) terpasang di halaman Follower.

---

### Fase 2 — Multi API-Key Rotation (SELESAI)
- Manajemen multi API key Apify (`apps/worker/src/keyRotation.ts`):
  - Proactive quota rotation saat sisa kuota bulanan ≤ 5% (FR-3.2–3.3).
  - Reactive quota rotation saat menerima HTTP 402 Payment Required (FR-3.4).
  - Penanganan HTTP 401/403 invalid key (FR-3.5).
  - Auto-reaktivasi key ketika periode `usage_cycle_ends_at` telah lewat (FR-3.6).
  - Auto-pause sistem jika seluruh key non-aktif (FR-3.7).
- Endpoint CRUD API keys (`GET/POST /api/apify-keys`, `DELETE /api/apify-keys/[id]`).
- UI manajemen key (`apps/web/app/settings/apify-keys/page.tsx`) dengan progress bar kuota dan masking token.

---

### Fase 3 — Re-import & Integritas Data (SELESAI)
- Verifikasi ketat mekanisme find-or-create pada import dan re-scraping: 0 duplikasi, tidak mereset status scraping yang telah selesai/gagal.
- Endpoint retry manual per follower (`POST /api/followers/[username]/retry`).
- Aksi tombol retry manual pada tabel follower dengan feedback visual.

---

### Fase 4 — Pipeline Embedding (SELESAI)
- Client OpenRouter embedding (`apps/worker/src/openrouterClient.ts`) menggunakan model gratis `liquid/lfm-2.5-embedding-350m:free` (1024 dimensi).
- Embedding worker loop (`apps/worker/src/embeddingLoop.ts`) dengan batching 10–20 post, pemotongan teks ≤ 512 token (~1800 karakter), dan penanganan HTTP 429 rate-limit dengan backoff tanpa menandai post gagal.
- Endpoint statistik ringkasan embedding (`GET /api/posts/embedding-summary`).
- Worker background (`apps/worker/src/index.ts`) menjalankan scraping dan embedding loop secara concurrent dan anggun terhadap shutdown (`SIGINT`/`SIGTERM`).

---

### Fase 5 — Dashboard Analitik (SELESAI)
- Database Materialized Views di PostgreSQL dengan unique index untuk concurrent refresh:
  - `mv_top_reposted_accounts`
  - `mv_trending_hashtags`
  - `mv_repost_activity_timeline`
- Endpoint agregat dashboard (`GET/POST /api/dashboard/summary`).
- UI visualisasi interaktif (`apps/web/app/dashboard/page.tsx`) menggunakan Recharts:
  - Top 10 Akun Paling Sering Di-repost (Horizontal BarChart).
  - Tren Aktivitas Repost Sepanjang Waktu (AreaChart).
  - Cloud / Badge Tren Hashtag Teratas.
  - Kartu Ringkasan Metrik (Total Follower, Total Post, Total Repost, Tingkat Partisipasi).

---

### Fase 6 — Chatbot RAG (SELESAI)
- Sistem RAG cerdas dengan OpenRouter model gratis (`openrouter/free` atau model `:free` terkonfigurasi di env):
  - Tool `semantic_search`: pencarian kemiripan kosinus pgvector (`<=>`) dengan fallback pencarian teks kata kunci.
  - Tool `query_aggregate`: query statistik langsung ke materialized view.
  - Tool `render_chart`: generative dynamic chart rendering (BarChart/LineChart/PieChart).
- Endpoint percakapan berulang (`POST /api/chat`) dan riwayat pesan (`GET/DELETE /api/chat/history`).
- UI chat modern (`apps/web/app/chat/page.tsx`) dengan quick prompt pills, bubble percakapan responsif, dan render grafik inline interaktif.

---

### Fase 7 — Autentikasi & Polish (SELESAI)
- NextAuth Credentials provider statis single-user dengan hashing bcrypt (`apps/web/lib/auth.ts`).
- Middleware proteksi route Next.js (`apps/web/middleware.ts`) mengamankan `/dashboard`, `/chat`, dan `/settings/*`.
- Halaman login bergaya elegan (`apps/web/app/(auth)/login/page.tsx`).
- Seluruh 10/10 skenario pengujian manual dari `SRS.md` §10 lulus 100% via regression suite `scratch/test_full_system_verification.ts`.
- Navigasi navbar konsisten, antarmuka berbahasa Indonesia yang ramah, dan build Next.js production lulus tanpa error.
- Verifikasi langsung via peramban web (browser session): alur login -> dashboard -> chatbot -> kelola followers -> kelola API keys berjalan sempurna.
