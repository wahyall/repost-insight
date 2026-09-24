# RepostInsight — Product Requirements Document (PRD)

| | |
|---|---|
| **Dokumen** | Product Requirements Document |
| **Proyek** | RepostInsight |
| **Versi** | 1.1 (dipisah dari dokumen gabungan) |
| **Tanggal** | 24 September 2026 |
| **Pemilik** | Wahyu |

Rujukan bisnis lengkap ada di `BRD.md`. Rujukan teknis detail ada di `SRS.md`.

## 1. Ringkasan Produk & Value Proposition

RepostInsight mengubah data mentah "siapa me-repost apa" menjadi insight yang bisa ditanya lewat bahasa natural dan divisualisasikan lewat dashboard — tanpa perlu pemilik akun membaca ribuan repost satu per satu secara manual.

## 2. Target Pengguna & Konteks Penggunaan

Single user: Wahyu, sebagai pemilik akun Instagram sekaligus developer & analis data. Login menggunakan kredensial statis (bukan sistem multi-akun). Konteks penggunaan: dicek secara berkala (harian/mingguan sesuai kebutuhan) untuk melihat tren, atau dipakai saat butuh ide konten/evaluasi konten tertentu.

## 3. User Stories & Acceptance Criteria

### US-1 — Import daftar follower
**Sebagai** pemilik akun, **saya ingin** meng-import daftar follower dari file export Instagram, **agar** sistem tahu siapa saja yang perlu di-scrape.

- Given file `followers.json` valid diunggah, When proses import dijalankan, Then setiap username baru dibuat sebagai baris `pending` di tabel followers.
- Given file kosong atau format tidak sesuai, When diunggah, Then sistem menampilkan pesan error yang jelas, bukan gagal diam-diam.

### US-2 — Scraping resumable
**Sebagai** pemilik akun, **saya ingin** menjalankan scraping yang bisa di-pause & dilanjutkan kapan saja, **agar** bisa mematikan laptop tanpa kehilangan progres.

- Given proses scraping sedang berjalan, When tombol Pause ditekan, Then worker berhenti mendispatch batch baru (run yang sudah berjalan tetap dibiarkan selesai).
- Given laptop dimatikan paksa saat beberapa follower berstatus `in_progress`, When aplikasi dinyalakan ulang, Then worker merekonsiliasi status run tersebut lewat API Apify sebelum melanjutkan antrean baru.

### US-3 — Multi API-key Apify
**Sebagai** pemilik akun, **saya ingin** menambahkan beberapa API key Apify, **agar** scraping tidak berhenti total saat satu akun kena limit.

- Given satu key mencapai limit kuota (HTTP 402), When dispatch berikutnya dijalankan, Then sistem otomatis memakai key aktif lain tanpa menandai follower sebagai gagal.
- Given seluruh key berstatus non-aktif, When worker mencoba dispatch, Then sistem otomatis pause dan menampilkan notifikasi di UI.

### US-4 — Re-import follower
**Sebagai** pemilik akun, **saya ingin** meng-import ulang daftar follower terbaru, **agar** follower baru otomatis masuk antrean tanpa mengulang follower lama.

- Given file follower baru berisi campuran username lama & baru, When re-import dijalankan, Then hanya username baru yang ditambahkan sebagai `pending`; status follower lama tidak berubah.

### US-5 — Tanya chatbot topik kualitatif
**Sebagai** pemilik akun, **saya ingin** bertanya ke chatbot tentang topik yang lagi dibahas followers, **agar** tidak perlu query manual ke database.

- Given data repost & embedding sudah tersedia, When pertanyaan kualitatif diajukan ("topik apa yang lagi ramai?"), Then chatbot melakukan retrieval semantik dan menjawab berbasis hasil retrieval tersebut.

### US-6 — Minta grafik dari chatbot
**Sebagai** pemilik akun, **saya ingin** meminta chatbot menampilkan grafik saat relevan, **agar** insight lebih cepat dipahami secara visual.

- Given pertanyaan bersifat statistik/agregat ("akun apa paling sering di-repost?"), When chatbot menjawab, Then chatbot memanggil tool `render_chart` dan hasilnya dirender sebagai chart, bukan teks/ASCII.

### US-7 — Dashboard tanpa chatbot
**Sebagai** pemilik akun, **saya ingin** melihat dashboard tren repost tanpa harus bertanya ke chatbot, **agar** insight rutin bisa dipantau sekilas.

- Given data sudah ada, When halaman dashboard dibuka, Then top akun di-repost, tren hashtag, dan aktivitas repost per waktu langsung tampil tanpa perlu interaksi tambahan.

### US-8 — Login sederhana
**Sebagai** pemilik akun, **saya ingin** login dengan kredensial sederhana, **agar** aplikasi tidak bisa diakses sembarang orang di jaringan yang sama.

- Given kredensial salah dimasukkan, When submit login, Then akses ditolak dan tidak ada halaman aplikasi yang bisa diakses tanpa sesi valid.

## 4. Deskripsi Fitur Detail

| ID | Fitur | Deskripsi Singkat |
|---|---|---|
| F1 | Import & manajemen followers | Import awal dari `followers.json`; re-import dengan logic *find-or-create* |
| F2 | Mesin scraping resumable | Worker loop berbasis status database, tahan pause/shutdown, concurrency terbatas |
| F3 | Manajemen multi API-key Apify | Tambah/hapus key, auto-rotate saat limit, auto-reaktivasi setelah reset |
| F4 | Penyimpanan & normalisasi data | Skema `posts` + `repost_events` (many-to-many), *find-or-create* saat re-scrape |
| F5 | Pipeline embedding | Resumable, model gratis OpenRouter, retry saat rate-limit |
| F6 | Chatbot RAG | Retrieval semantik + tool query agregat + tool render grafik |
| F7 | Dashboard analitik | Top akun, tren hashtag, aktivitas waktu — dari materialized view |
| F8 | Autentikasi statis | Login single-user sederhana |
| F9 | Monitoring internal | Status scraping, sisa kuota API key, status embedding |

*(Spesifikasi teknis mendetail tiap fitur — FR-x.x — ada di `SRS.md` §3.)*

## 5. Non-Goals

- Tidak ada dukungan multi-user/multi-akun Instagram.
- Tidak ada fitur monetisasi, sharing publik, atau ekspor ke pihak ketiga.
- Tidak menangani aspek legal/compliance data follower (lihat BRD §5).
- Tidak dirancang untuk skala di luar ±15.000 follower / satu laptop.

## 6. Prioritas Rilis

Sesuai keputusan pemilik proyek, **tidak ada pemisahan MVP vs fase berikutnya** — seluruh fitur F1–F9 adalah scope v1 ("full vision"). Urutan pengerjaan teknis mengikuti `GRAND_PLAN.md`, bukan berarti ada pengurangan scope produk.

## 7. Overview Layar (Screens)

| Layar | Tujuan | Elemen Kunci |
|---|---|---|
| Login | Autentikasi single-user | Form username + password |
| Dashboard | Insight ringkas tanpa perlu bertanya | Chart top akun di-repost, tren hashtag, heatmap aktivitas |
| Chat | Tanya-jawab bebas ke chatbot RAG | Riwayat percakapan, input teks, area render grafik inline |
| Settings → Followers | Kelola daftar follower | Upload/re-import `followers.json`, ringkasan status (pending/in_progress/done/failed), tombol pause/resume scraping |
| Settings → API Keys | Kelola multi API-key Apify | Tabel key dengan label, status, sisa kuota; tombol tambah/hapus |

## 8. Metrik Sukses Produk

- Chatbot menjawab pertanyaan analitik dengan benar memilih jalur (retrieval semantik vs query agregat) sesuai jenis pertanyaan.
- Dashboard mencerminkan data terbaru (setelah materialized view refresh) tanpa delay yang mengganggu.
- Proses scraping & embedding tidak pernah menghasilkan data duplikat meski dijalankan berulang kali (find-or-create bekerja konsisten).
