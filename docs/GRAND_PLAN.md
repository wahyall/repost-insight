# RepostInsight — Grand Plan / Roadmap

| | |
|---|---|
| **Dokumen** | Grand Plan / Roadmap |
| **Proyek** | RepostInsight |
| **Versi** | 1.1 (dipisah dari dokumen gabungan) |
| **Tanggal** | 24 September 2026 |

Rujukan requirement per fitur: `SRS.md`. Rujukan struktur kode: `PROJECT_STRUCTURE.md`.

Timeline bersifat santai (tanpa deadline keras, sesuai `BRD.md` §8). Fase disusun berdasarkan **urutan logis ketergantungan**, bukan estimasi tanggal kalender. Scope produk sudah "full vision" sejak v1 (`PRD.md` §6) — pemecahan di bawah murni demi kepraktisan pengerjaan.

## Fase 0 — Fondasi (Effort: Kecil)

- [x] Inisialisasi monorepo sesuai `PROJECT_STRUCTURE.md` §1 (workspace `apps/*`, `packages/*`)
- [x] Setup `packages/db` dengan Prisma schema dasar (§3 di `PROJECT_STRUCTURE.md`)
- [x] Jalankan Postgres+pgvector lokal via `docker-compose.yml`
- [x] Jalankan migration awal + tambahkan kolom `embedding vector(1024)` manual (lihat `PROJECT_STRUCTURE.md` §4)
- [x] Buat endpoint `POST /api/followers/import` (FR-1.1–1.5) dan uji dengan `followers.json` asli
- [x] Uji manual: import file valid, file kosong, file rusak

**Definition of Done**: `followers.json` bisa diimpor, seluruh username tersimpan sebagai baris `pending` di tabel `followers`, tanpa duplikat saat dijalankan dua kali.

## Fase 1 — Scraping Engine, Single Key (Effort: Sedang)

- [x] Implementasi `apifyClient.ts` (dispatch run, cek status, ambil dataset — SRS §5)
- [x] Implementasi `scrapeLoop.ts` (FR-2.1–2.3): dispatch batch, rekonsiliasi saat start-up
- [x] Implementasi tabel & logic `scrape_control` (pause/resume — FR-2.4–2.5)
- [x] Implementasi retry otomatis untuk run gagal (FR-2.7)
- [x] Endpoint `POST /api/scrape-control/pause` & `/resume`
- [x] UI dasar di `settings/followers`: tabel status followers + tombol pause/resume
- [x] Uji manual: pause di tengah proses, paksa-matikan proses lalu nyalakan ulang, pastikan rekonsiliasi bekerja

**Definition of Done**: scraping berjalan otomatis dari `pending` → `done`/`failed`, tahan terhadap proses yang dihentikan paksa kapan saja.

## Fase 2 — Multi API-Key Rotation (Effort: Sedang)

- [x] Tabel `apify_api_keys` (sudah ada di schema Fase 0, aktifkan logic-nya)
- [x] Endpoint `GET/POST /api/apify-keys`, `DELETE /api/apify-keys/:id`
- [x] Implementasi `keyRotation.ts`: cek kuota proaktif (FR-3.2–3.3), tangani HTTP 402 reaktif (FR-3.4), tangani 401/403 (FR-3.5)
- [x] Auto-reaktivasi key setelah `usage_cycle_ends_at` lewat (FR-3.6)
- [x] Auto-pause seluruh sistem jika semua key non-aktif (FR-3.7)
- [x] UI settings `apify-keys`: tambah/hapus key, tampilkan status & sisa kuota
- [x] Uji manual: tandai satu key `exhausted` secara manual, pastikan worker pindah ke key lain otomatis

**Definition of Done**: scraping tidak pernah berhenti total selama masih ada minimal satu key aktif; pemilik bisa menambah key baru kapan saja lewat UI.

## Fase 3 — Re-import & Integritas Data (Effort: Kecil)

- [x] Tambahkan logic find-or-create pada endpoint import (FR-1.3–1.4) agar bisa dipakai ulang sebagai re-import
- [x] Implementasi find-or-create pada penyimpanan hasil scraping (FR-4.1–4.3): upsert `posts`, upsert `repost_events`
- [x] Endpoint retry manual per follower (`POST /api/followers/:username/retry`)
- [x] Uji manual: re-import file dengan sebagian username sama & baru; scrape ulang follower yang sama, pastikan tidak ada baris duplikat di `repost_events`

**Definition of Done**: re-import dan re-scrape berulang kali tidak pernah menghasilkan data duplikat maupun mereset progres yang sudah ada.

## Fase 4 — Pipeline Embedding (Effort: Sedang)

- [x] Implementasi `openrouterClient.ts` untuk `/v1/embeddings`
- [x] Implementasi `embeddingLoop.ts` (FR-5.1–5.4): ambil batch `pending`, embed, simpan vector, retry dengan backoff
- [x] Truncation teks sebelum embed agar tidak melebihi 512 token (FR-5.3)
- [x] UI monitoring: jumlah post `pending` vs `done` embedding (FR-9.3)
- [x] Uji manual: simulasikan rate-limit (banyak request cepat), pastikan status tetap `pending` bukan `failed`

**Definition of Done**: seluruh post yang berhasil di-scrape akhirnya memiliki embedding, proses tahan terhadap rate-limit tier gratis.

## Fase 5 — Dashboard Analitik (Effort: Sedang)

- [x] Buat materialized views agregat (top akun di-repost, tren hashtag, aktivitas per waktu — FR-7.1)
- [x] Jadwalkan refresh berkala materialized view (FR-7.2)
- [x] Endpoint `GET /api/dashboard/summary`
- [x] UI dashboard dengan Recharts (FR-7.3)
- [x] Uji manual: bandingkan angka dashboard dengan query manual ke tabel mentah setelah refresh

**Definition of Done**: dashboard menampilkan insight yang akurat dan tidak membebani database (tidak query tabel mentah langsung tiap load halaman).

## Fase 6 — Chatbot RAG (Effort: Besar)

- [x] Definisikan tool `semantic_search`, `query_aggregate`, `render_chart` (FR-6.1–6.4)
- [x] Implementasi endpoint `POST /api/chat` dengan OpenRouter (`openrouter/free` atau model `:free` spesifik) + tool calling
- [x] Keputusan final: pakai CopilotKit atau Vercel AI SDK murni untuk chat UI (lihat Open Items di bawah)
- [x] Implementasi penyimpanan riwayat chat (`chat_messages` — FR-6.5) + endpoint `GET /api/chat/history`
- [x] UI chat: bubble percakapan + area render grafik inline
- [x] Uji manual: ajukan pertanyaan kualitatif vs statistik, pastikan tool yang tepat terpanggil; minta grafik, pastikan hasilnya benar-benar chart

**Definition of Done**: chatbot bisa menjawab kedua jenis pertanyaan (kualitatif & statistik) dengan tepat, dan bisa menampilkan grafik saat diminta.

## Fase 7 — Autentikasi & Polish (Effort: Kecil)

- [x] Setup NextAuth Credentials Provider (FR-8.1–8.2)
- [x] Middleware proteksi seluruh route
- [x] Review & jalankan seluruh checklist manual di `SRS.md` §10 secara menyeluruh
- [x] Review UI/UX ringkas (bahasa Indonesia konsisten di semua halaman)

**Definition of Done**: aplikasi tidak bisa diakses tanpa login, seluruh checklist pengujian manual lolos.

## Fase 8 — Deskripsi Visual Konten, Gambar & Video (Effort: Sedang-Besar)

Spesifikasi lengkap: `VISUAL_DESCRIPTION.md`.

- [x] Tambah kolom `visual_description` & `visual_description_status` ke tabel `posts`
- [x] Tambah dependency `ffmpeg-static` di `apps/worker`
- [x] Implementasi `describeImagePost()` untuk foto/carousel, sertakan caption sebagai konteks prompt (FR-10.1)
- [x] Implementasi `describeVideoPost()`: describe thumbnail/cover + download video + ekstrak 3-5 frame merata (FR-10.2), describe tiap sumber dengan konteks caption, gabungkan
- [x] Integrasikan pemanggilan di atas ke `scrapeLoop.ts` langsung setelah find-or-create post (FR-10.3), bukan loop terpisah
- [x] Reset `embedding_status` ke `pending` setiap kali `visual_description` terisi (FR-10.4)
- [x] Pastikan file video/frame sementara selalu dibersihkan (FR-10.7)
- [ ] Uji manual: post foto, post video pendek (<15s), post video panjang (>45s), dan kasus URL sudah expired (harus gagal rapi, bukan crash worker)

**Definition of Done**: post foto & video baru otomatis punya `visual_description` yang tersimpan dan ikut ter-embed ulang, tanpa mengganggu jalannya scraping post lain saat satu post gagal diproses.

## Fase 9 — Katalog Repost per Akun Follower (Effort: Sedang)

- [x] Endpoint `GET /api/reposts`: query reposts yang dikelompokkan per follower dengan pagination, search (follower & konten/caption/hashtag), filter tipe media, filter status visi AI, dan sorting
- [x] Ekstraksi aman thumbnail Instagram dari `rawJson` tanpa membebani payload jaringan
- [x] UI Katalog Repost (`/reposts`): bento ringkasan statistik (total follower reposter, total repost, rerata repost, visi AI)
- [x] Accordion list follower dengan badge status, jumlah repost, pratinjau kreator asal, dan tautan profil Instagram
- [x] Grid kartu postingan responsif: thumbnail media (referrerPolicy anti-blokir), badge tipe media, likes/plays, teks caption collapsible, hashtag chips, analisis visual AI callout, dan tautan langsung ke Instagram
- [x] Integrasi navigasi: menu baru "Katalog Repost" di `Navbar.tsx` dan kartu navigasi cepat di halaman beranda (`page.tsx`)

**Definition of Done**: pengguna dapat melihat dan mencari seluruh repost yang dikelompokkan per follower secara terstruktur, cepat, dan responsif.

## Open Items / Hal yang Masih Bisa Berubah

- Pilihan final CopilotKit vs Vercel AI SDK murni untuk chat UI — diputuskan saat mulai Fase 6.
- Ambang batas (%) sisa kuota untuk proactive key rotation (FR-3.3) — disetel berdasarkan pengalaman nyata setelah beberapa siklus scraping.
- Nilai `max_concurrency` final — disesuaikan setelah mengecek limit concurrent run masing-masing akun Apify yang dipakai.

## Panduan Alur Kerja untuk Claude Code

- Kerjakan satu fase penuh sebelum pindah ke fase berikutnya, kecuali ada dependency yang memaksa lompat (jarang terjadi karena urutan sudah disusun sesuai ketergantungan).
- Sebelum mengerjakan fase tertentu, baca bagian FR terkait di `SRS.md` §3 dan skema di `SRS.md` §4 — jangan berasumsi struktur data di luar yang sudah didefinisikan tanpa konfirmasi ke pemilik proyek.
- Checklist di tiap fase di atas bisa dicentang langsung di file ini sebagai penanda progres.
