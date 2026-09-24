# RepostInsight

Aplikasi riset personal untuk menganalisis data repost Instagram followers `@ynsurabaya` (target 10.000–15.000 follower) via Apify actor `data-slayer/instagram-reposts`, penyimpanan lokal PostgreSQL + pgvector, serta analisis cerdas via Chatbot RAG (model gratis OpenRouter) dan Dashboard Analitik interaktif.

Berjalan sepenuhnya secara lokal pada laptop Windows (Intel i5 gen-7, RAM 8GB), single-user, dengan efisiensi sumber daya maksimal tanpa Redis/BullMQ.

---

## Arsitektur Monorepo

Sistem disusun menggunakan npm workspaces monorepo:

```
RepostInsight/
├── apps/
│   ├── web/        # Next.js 14 App Router (Dashboard, Chatbot RAG, Settings & Auth)
│   └── worker/     # Background Worker Node.js/tsx (Scraping Loop & Embedding Loop)
├── packages/
│   └── db/         # Prisma Client + pgvector (Database Schema, Migrations, Seed)
├── docker-compose.yml # Container PostgreSQL 16 + pgvector (localhost:5432)
├── docs/           # BRD, PRD, SRS, GRAND_PLAN, PROJECT_STRUCTURE
└── .env            # Environment variables & kredensial lokal
```

---

## Prasyarat Lingkungan

- **Node.js**: v18+ (direkomendasikan v20 atau v22)
- **Docker Desktop**: dengan backend WSL2 aktif (untuk PostgreSQL 16 + pgvector)

---

## Panduan Cepat Menjalankan Sistem

### 1. Jalankan Database Lokal

```bash
docker compose up -d
```
Container `repostinsight-db` akan berjalan di port `5432`.

### 2. Konfigurasi Environment (`.env`)

Salin file `.env.example` menjadi `.env` jika belum ada:
```bash
cp .env.example .env
```

Isi variabel utama:
- `OPENROUTER_API_KEY`: API Key OpenRouter Anda (gratis).
- `AUTH_USERNAME`: Username login (default: `wahyu`).
- `AUTH_PASSWORD_HASH`: Kosongkan untuk menggunakan password default `admin123` / `password123`.

### 3. Jalankan Aplikasi Web (Next.js)

Jalankan server aplikasi web:
```bash
# Menjalankan build production (direkomendasikan untuk stabilitas & hemat memori)
npm run build
npm run start

# Atau mode development:
npm run dev
```

Buka peramban di [http://localhost:3000](http://localhost:3000):
- **Username**: `wahyu`
- **Password**: `admin123`

### 4. Jalankan Background Worker (Scraping & Embedding)

Di terminal terpisah, jalankan engine worker:
```bash
npm run worker
```

Worker akan:
1. Melakukan rekonsiliasi status scraping yang belum selesai saat startup (`reconcileInProgressFollowers`).
2. Menjalankan scraping loop jika engine tidak dijeda (`scrape_control.is_paused = false`).
3. Mengambil batch post pending dan membuat representasi embedding vektor via OpenRouter secara otomatis.
4. Mendukung penghentian anggun (graceful shutdown) dengan tombol `Ctrl + C`.

---

## Fitur Utama

- **F1: Import Followers**: Upload file `followers_1.json` hasil ekspor Instagram langsung dari UI dengan deteksi username otomatis dan pencegahan duplikasi.
- **F2: Scraping Resumable**: Mengambil maksimal 20 repost per follower via Apify. Status disimpan di database sehingga aman dimatikan kapan saja.
- **F3: Multi API-Key Rotation**: Rotasi otomatis API key Apify proaktif (sisa kuota bulanan ≤ 5%) dan reaktif (HTTP 402/401/403).
- **F4: Re-import & Integritas Data**: Find-or-create logic di seluruh level: tidak pernah mereset status scraping dan 0 duplikasi baris data.
- **F5: Pipeline Embedding Otomatis**: Vektorisasi teks caption & hashtag menggunakan model gratis `liquid/lfm-2.5-embedding-350m:free` (1024 dimensi) ke kolom `pgvector`.
- **F6: Chatbot RAG Cerdas**: Percakapan tanya-jawab interaktif dengan dukungan *tool calling*:
  - `semantic_search`: Temukan pola konten dan isu spesifik lewat pencarian vektor semantik.
  - `query_aggregate`: Ekstraksi statistik cepat langsung dari materialized views.
  - `render_chart`: Generasi grafik interaktif inline (bar, line, pie).
- **F7: Dashboard Analitik**: Visualisasi Recharts interaktif: Top 10 akun paling sering di-repost, tren linimasa aktivitas repost, dan awan tagar populer.
- **F8: Keamanan & Autentikasi**: Proteksi NextAuth single-user dan middleware pada seluruh route privat.
- **F9: Monitoring & Kontrol UI**: Tombol jeda/lanjutkan engine seketika, monitor kuota API key, dan statistik embedding.

---

## Verifikasi & Pengujian Sistem

Proyek ini telah dilengkapi dengan suite pengujian manual dan verifikasi menyeluruh 10/10 skenario sesuai **SRS.md §10**:

```bash
npx tsx scratch/test_full_system_verification.ts
```

Output:
```
✔ [PASS]  | TC-1: Import Followers Valid
✔ [PASS]  | TC-2: Re-import Find-or-Create (No Reset)
✔ [PASS]  | TC-3: File Kosong/Rusak Ditolak
✔ [PASS]  | TC-4: Scrape Control Pause/Resume
✔ [PASS]  | TC-5: Startup Reconciliation
✔ [PASS]  | TC-6: Multi API-Key Rotation
✔ [PASS]  | TC-7: Pipeline Embedding & pgvector
✔ [PASS]  | TC-8: Dashboard Materialized Views
✔ [PASS]  | TC-9: Chatbot Tools (RAG/Aggregate/Chart)
✔ [PASS]  | TC-10: Autentikasi Statis & Bcrypt Hash
```
