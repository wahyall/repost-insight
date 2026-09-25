# Migrate OpenRouter Services to Local Ollama Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti semua service berbasis OpenRouter (embedding, visual description, chatbot RAG, semantic search) dengan model lokal Ollama (`qwen3-vl:4b` dan `qwen3-embedding:0.6b`), memigrasikan kolom vektor pgvector ke 1024 dimensi, dan mengonfigurasi opsi CPU (`num_gpu: 0`) untuk kestabilan GPU lawas.

**Architecture:** Menggunakan Ollama HTTP API lokal (`http://localhost:11434`) untuk `/api/embed` (vektor 1024 dimensi) dan `/v1/chat/completions` (multimodal vision + tool-calling chat). Memigrasikan tabel PostgreSQL pgvector dari `vector(2048)` kembali ke `vector(1024)`, me-reset status embedding post agar di-embed ulang, dan mengonfigurasi fallback/environment variable secara rapi.

**Tech Stack:** Node.js, Next.js, Prisma ORM, PostgreSQL 16 + pgvector, Ollama API, Qwen3-VL 4B, Qwen3-Embedding 0.6B.

---

### Task 1: Database Schema & pgvector 1024-Dimension Migration

**Files:**
- Create: `packages/db/src/migrate_fase_ollama.ts`
- Modify: `packages/db/prisma/schema.prisma:35-40`
- Modify: `docs/SRS.md:150`
- Modify: `docs/PROJECT_STRUCTURE.md:138`

- [ ] **Step 1: Update Prisma schema definition to vector(1024)**
Ubah tipe kolom `embedding` di `packages/db/prisma/schema.prisma` dari `Unsupported("vector(2048)")?` menjadi `Unsupported("vector(1024)")?`.

- [ ] **Step 2: Create migration script `migrate_fase_ollama.ts`**
Buat skrip migrasi SQL di `packages/db/src/migrate_fase_ollama.ts` untuk:
1. Mengecek tipe kolom `embedding` saat ini di tabel `posts`.
2. Melakukan drop dan recreate kolom menjadi `vector(1024)`.
3. Mengubah `embedding_status = 'pending'` untuk seluruh post yang sebelumnya `done` agar dihitung ulang dengan model Qwen3-Embedding 0.6B.

- [ ] **Step 3: Run migration script**
Jalankan migrasi: `npx.cmd tsx src/migrate_fase_ollama.ts` dari dalam folder `packages/db`.
Verifikasi output console menyatakan kolom `embedding` berhasil bertipe `vector(1024)`.

---

### Task 2: Implement Ollama Embedding Client & Update Worker Embedding Loop

**Files:**
- Create: `apps/worker/src/ollamaClient.ts`
- Modify: `apps/worker/src/embeddingLoop.ts:1-75`
- Modify: `apps/worker/src/index.ts:12-65`

- [ ] **Step 1: Create `apps/worker/src/ollamaClient.ts`**
Implementasikan `OllamaEmbeddingService` yang memanggil `POST http://localhost:11434/api/embed` dengan model `qwen3-embedding:0.6b` dan `options: { num_gpu: 0 }`.
Fungsi menerima array string teks dan mengembalikan array `{ index, embedding }` dengan float 1024 dimensi.

- [ ] **Step 2: Update `apps/worker/src/embeddingLoop.ts`**
Ganti dependensi `OpenRouterEmbeddingService` dengan `OllamaEmbeddingService`. Hapus logika delay rate limit OpenRouter yang lambat (karena lokal tidak ada rate limit 429).

- [ ] **Step 3: Update `apps/worker/src/index.ts`**
Inisialisasi `OllamaEmbeddingService` menggantikan `OpenRouterEmbeddingService` pada fungsi bootstrap `main()`.

- [ ] **Step 4: Verify embedding worker locally**
Jalankan `scratch/test_ollama_embed.ts` untuk memverifikasi model menghasilkan vektor 1024 dimensi tanpa error.

---

### Task 3: Migrate Visual Description Service to Local Ollama Vision Model (`qwen3-vl:4b`)

**Files:**
- Modify: `apps/worker/src/visualDescriber.ts:88-210`

- [ ] **Step 1: Update `callVisionModel` in `visualDescriber.ts`**
Ganti panggilan OpenRouter API dengan pemanggilan langsung ke Ollama API (`POST http://localhost:11434/api/chat` atau `POST http://localhost:11434/v1/chat/completions`) menggunakan model `qwen3-vl:4b`:
- Jika sumber gambar adalah URL eksternal (Instagram CDN), ambil buffer gambar via `fetch()`, ubah ke base64 string.
- Jika sumber gambar lokal (frame video), baca file via `fs.readFile()` dan jadikan base64 string.
- Kirim request ke Ollama dengan `options: { num_gpu: 0 }`.

- [ ] **Step 2: Update `callChatCompletion` in `visualDescriber.ts`**
Ganti panggilan chat penyatuan deskripsi frame video dengan Ollama chat completion menggunakan model `qwen3-vl:4b`.

---

### Task 4: Migrate Web Chatbot RAG & Semantic Search to Ollama

**Files:**
- Modify: `apps/web/lib/tools/index.ts:8-85`
- Modify: `apps/web/app/api/chat/route.ts:184-310`

- [ ] **Step 1: Update `executeSemanticSearch` in `apps/web/lib/tools/index.ts`**
Ganti pemanggilan OpenRouter `/v1/embeddings` dengan pemanggilan Ollama `POST http://localhost:11434/api/embed` menggunakan model `qwen3-embedding:0.6b`.
Ambil vektor 1024 dimensi dari hasil query dan jalankan pencarian kosinus pgvector (`<=>`).

- [ ] **Step 2: Update `/api/chat` route in `apps/web/app/api/chat/route.ts`**
Ganti pemanggilan endpoint OpenRouter `https://openrouter.ai/api/v1/chat/completions` dengan Ollama OpenAI-compatible endpoint `http://localhost:11434/v1/chat/completions`.
- Model: `process.env.OLLAMA_CHAT_MODEL || "qwen3-vl:4b"`.
- Teruskan payload messages, tools (`CHATBOT_TOOLS`), dan parse tool calls yang dikembalikan oleh Qwen3-VL 4B.

---

### Task 5: Update Environment Variables & Documentation

**Files:**
- Modify: `.env`, `.env.example`, `apps/worker/.env`, `apps/web/.env`
- Modify: `CLAUDE.md` and `AGENTS.md`
- Modify: `task_plan.md` and `progress.md`

- [ ] **Step 1: Update all `.env` files**
Tambahkan konfigurasi Ollama:
```env
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_CHAT_MODEL="qwen3-vl:4b"
OLLAMA_VISION_MODEL="qwen3-vl:4b"
OLLAMA_EMBEDDING_MODEL="qwen3-embedding:0.6b"
```

- [ ] **Step 2: Update documentation memory files**
Perbarui `AGENTS.md`, `CLAUDE.md`, `task_plan.md`, dan `progress.md` untuk mencatat bahwa provider LLM, Vision, dan Embedding telah dimigrasikan dari OpenRouter ke Ollama Local (`qwen3-vl:4b` dan `qwen3-embedding:0.6b`).

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Test embedding pipeline with pgvector**
Jalankan skrip tes untuk memverifikasi penyimpanan vektor 1024-dimensi ke PostgreSQL pgvector dan jalankan query jarak kosinus (`<=>`).

- [ ] **Step 2: Test Chatbot RAG endpoint**
Kirim request POST ke `/api/chat` dengan pertanyaan semantik untuk memastikan bot mengeksekusi tool `semantic_search` menggunakan model lokal Ollama.
