# Task Plan: RepostInsight Implementation

## Project Overview
RepostInsight: Scraping follower Instagram `ynsurabaya` (10k-15k followers) via Apify actor `data-slayer/instagram-reposts`, penyimpanan di Postgres+pgvector lokal, analisis lewat Chatbot RAG (OpenRouter free model) dan dashboard analitik Next.js.
Environment: Local Windows laptop (Intel i5 gen-7, RAM 8GB), single-user, budget Rp0.

## User Constraints & Rules
- Sesuai `AGENTS.md`, kerjakan per fase sesuai urutan di `docs/GRAND_PLAN.md` dan centang checklist sebagai penanda progres.
- Konvensi penamaan & struktur folder mengikuti `docs/PROJECT_STRUCTURE.md`.
- Skema database di `docs/SRS.md` §4 dan `docs/PROJECT_STRUCTURE.md` §3.
- Worker resumable, status disimpan di Postgres, tanpa Redis/BullMQ.
- Model embedding: `liquid/lfm-2.5-embedding-350m:free` (1024 dim), chat: `openrouter/free` (konfigurasi via env).
- UI Language: Bahasa Indonesia. Single-user static auth (Fase 7). Manual testing.

## Execution Phases

### Fase 0 — Fondasi [COMPLETE]
- [x] Inisialisasi monorepo sesuai `PROJECT_STRUCTURE.md` §1 (workspace `apps/*`, `packages/*`, package.json root)
- [x] Setup `packages/db` dengan Prisma schema dasar (§3 di `PROJECT_STRUCTURE.md`)
- [x] Setup container Postgres+pgvector via `docker-compose.yml` (atau koneksi DB lokal)
- [x] Jalankan migration awal + tambahkan kolom `embedding vector(1024)`
- [x] Buat endpoint `POST /api/followers/import` (FR-1.1–1.5)
- [x] Uji manual: import file valid (`followers_1.json`), file kosong, file rusak

### Fase 1 — Scraping Engine, Single Key [COMPLETE]
- [x] Implementasi `apifyClient.ts`
- [x] Implementasi `scrapeLoop.ts` (FR-2.1–2.3)
- [x] Implementasi tabel & logic `scrape_control` (FR-2.4–2.5)
- [x] Implementasi auto-retry run gagal (FR-2.7)
- [x] Endpoint `POST /api/scrape-control/pause` & `/resume`
- [x] UI dasar di `settings/followers`
- [x] Uji manual pause/resume/recovery

### Fase 2 — Multi API-Key Rotation [COMPLETE]
- [x] Logic rotasi API key Apify
- [x] Endpoint `/api/apify-keys`
- [x] Proactive & reactive key rotation (FR-3.2–3.7)
- [x] UI settings `apify-keys`

### Fase 3 — Re-import & Integritas Data [COMPLETE]
- [x] Find-or-create logic pada import & scraping posts/repost_events
- [x] Endpoint retry manual per follower (`POST /api/followers/:username/retry`)

### Fase 4 — Pipeline Embedding [COMPLETE]
- [x] `openrouterClient.ts` & `embeddingLoop.ts`
- [x] Truncation & exponential backoff rate limit
- [x] UI monitoring embedding status

### Fase 5 — Dashboard Analitik [COMPLETE]
- [x] Materialized views & scheduled refresh
- [x] Endpoint `/api/dashboard/summary`
- [x] UI dashboard dengan Recharts

### Fase 6 — Chatbot RAG [COMPLETE]
- [x] Tool definitions (`semantic_search`, `query_aggregate`, `render_chart`)
- [x] Endpoint `/api/chat` & `/api/chat/history`
- [x] UI chat dengan generative UI / charts

### Fase 7 — Autentikasi & Polish [COMPLETE]
- [x] NextAuth Credentials Provider & middleware
- [x] Review manual checklist `SRS.md` §10
- [x] Bahasa Indonesia consistency check

### Fase 8 — Visual Description & Dynamic Multimodal [COMPLETE]
- [x] Ekstraksi frame video reels via ffmpeg & visual description image/video
- [x] Kolom `visual_description` dan `visual_description_status`

### Fase 9 — Migrasi ke Ollama Local Models [IN PROGRESS]
- [x] Setup Ollama di Disk D (`D:\Ollama` dan `D:\Ollama\models`) untuk mengatasi kapasitas Disk C
- [x] Download dan verifikasi model `qwen3-embedding:0.6b` (1024-dimensi)
- [x] Migrasi database PostgreSQL pgvector dari `vector(2048)` ke `vector(1024)`
- [x] Implementasi `OllamaEmbeddingService` (`apps/worker/src/ollamaClient.ts`) dan update `embeddingLoop.ts`
- [x] Update `visualDescriber.ts` ke Ollama multimodal base64 & chat completion
- [x] Update `executeSemanticSearch` (`apps/web/lib/tools/index.ts`) ke Ollama embedding
- [x] Update `/api/chat` (`apps/web/app/api/chat/route.ts`) ke Ollama chat completion + tool calling
- [ ] Pull dan verifikasi `qwen3-vl:4b` selesai
- [ ] End-to-end verification (chatbot RAG, semantic search, vision test)
