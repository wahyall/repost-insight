# RepostInsight — Project Memory

Proyek riset personal: scraping data repost dari follower Instagram `ynsurabaya` (target 10.000–15.000 follower) via Apify actor `data-slayer/instagram-reposts`, disimpan di Postgres+pgvector lokal, dianalisis lewat chatbot RAG (OpenRouter, model gratis) dan dashboard. Berjalan sepenuhnya lokal di laptop Windows (Intel i5 gen-7, RAM 8GB), single-user, budget Rp0.

Baca dokumen berikut sebelum mulai mengerjakan apa pun — jangan berasumsi di luar yang sudah didefinisikan di sana tanpa konfirmasi ke pemilik proyek:

@docs/BRD.md
@docs/PRD.md
@docs/SRS.md
@docs/PROJECT_STRUCTURE.md
@docs/GRAND_PLAN.md

## Ringkasan keputusan kunci (lihat dokumen di atas untuk detail lengkap)

- Actor Apify `data-slayer/instagram-reposts` tidak mendukung multi-username per run; `maxItems: 20` per follower.
- Re-scrape & re-import followers wajib pakai logic find-or-create (SRS §3 F1, F4) — tidak boleh ada duplikat, tidak boleh mereset progres yang sudah ada.
- Worker (scraping & embedding) harus resumable: seluruh state disimpan di database, bukan di memory proses, karena laptop bisa dimatikan kapan saja. Run Apify tetap berjalan di server Apify meski laptop mati — worker cukup merekonsiliasi status saat start-up (SRS §3 FR-2.3).
- Embedding menggunakan Ollama model lokal (`qwen3-embedding:0.6b` untuk pgvector 1024-dim offline & zero rate-limit).
- Chatbot RAG (`/api/chat`) dan pemrosesan visual/image description (`visualDescriber.ts`) menggunakan 9Router API (`http://127.0.0.1:20128/v1`) dengan model `ag/gemini-3-flash`. Nama model, key, dan base URL dibaca dari env/config.
- Scope produk v1 = full vision (semua fitur F1–F9 di SRS), tidak dipecah MVP vs fase berikutnya — pemecahan hanya di level urutan pengerjaan (lihat GRAND_PLAN.md).
- Aspek legal/compliance data follower sengaja di luar cakupan proyek (keputusan sadar pemilik, lihat BRD §5) — tidak perlu diangkat ulang kecuali diminta pemilik proyek.
- Autentikasi: login statis single-user, bukan sistem multi-akun.
- Testing: manual saja, tidak ada automated test/CI yang perlu dibuat kecuali diminta.
- Bahasa UI: Indonesia.

## Cara bekerja di repo ini

- Kerjakan per fase sesuai urutan di `docs/GRAND_PLAN.md`; centang checklist di file tersebut sebagai penanda progres.
- Konvensi penamaan & struktur folder mengikuti `docs/PROJECT_STRUCTURE.md` — jangan menyimpang tanpa alasan kuat.
- Skema database final ada di `docs/SRS.md` §4 (juga direplikasi sebagai Prisma schema di `docs/PROJECT_STRUCTURE.md` §3) — perubahan skema harus tercermin di kedua tempat.
- Jika menemukan requirement yang ambigu atau bertentangan antar dokumen, tanyakan ke pemilik proyek daripada menebak.
