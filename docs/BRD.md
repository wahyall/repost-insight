# RepostInsight — Business Requirements Document (BRD)

|             |                                     |
| ----------- | ----------------------------------- |
| **Dokumen** | Business Requirements Document      |
| **Proyek**  | RepostInsight                       |
| **Versi**   | 1.1 (dipisah dari dokumen gabungan) |
| **Tanggal** | 24 September 2026                   |
| **Pemilik** | Wahyu                               |

## 1. Executive Summary

RepostInsight adalah sistem riset personal yang mengumpulkan data repost dari ribuan follower Instagram akun `ynsurabaya`, mengubahnya menjadi basis pengetahuan (RAG), lalu menyajikannya lewat chatbot dan dashboard analitik. Tujuannya murni personal: memahami topik yang relevan bagi audiens sebagai bahan evaluasi konten, ide konten baru, dan riset kompetitor.

## 2. Latar Belakang & Rumusan Masalah

**Konteks**: Akun `ynsurabaya` memiliki 10.000–15.000 follower. Sebagian follower secara rutin me-repost konten ke feed/story mereka — perilaku ini adalah sinyal minat/preferensi yang berharga tapi belum pernah dimanfaatkan.

**Masalah**: Melihat repost follower satu per satu secara manual mustahil dilakukan pada skala ribuan akun. Akibatnya, insight tentang topik yang sedang relevan bagi audiens hilang begitu saja, padahal bisa jadi bahan evaluasi dan ide konten yang berharga.

**Kesempatan**: Otomasi scraping dikombinasikan dengan RAG (Retrieval-Augmented Generation) memungkinkan data mentah ribuan repost diubah menjadi insight yang bisa ditanya dengan bahasa natural maupun dilihat lewat dashboard, tanpa perlu membaca satu per satu secara manual.

## 3. Tujuan Bisnis

| ID   | Tujuan                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------- |
| BG-1 | Menyediakan bahan evaluasi terhadap konten yang sudah dipublikasikan                                     |
| BG-2 | Menyediakan bahan ide untuk konten baru berdasarkan tren di kalangan follower                            |
| BG-3 | Memungkinkan riset kompetitor secara tidak langsung — topik apa yang beredar di antara audiens yang sama |

## 4. Stakeholder

| Peran                                  | Nama  | Kepentingan                                         |
| -------------------------------------- | ----- | --------------------------------------------------- |
| Pemilik produk & satu-satunya pengguna | Wahyu | Mendapatkan insight dari data repost follower       |
| Developer                              | Wahyu | Membangun & memelihara sistem (dibantu Claude Code) |

Tidak ada stakeholder eksternal. Ini murni proyek riset personal, bukan produk yang akan didistribusikan atau dikomersialkan.

## 5. Ruang Lingkup Bisnis

**In scope:**

- Scraping repost dari follower akun `ynsurabaya` menggunakan actor Apify `data-slayer/instagram-reposts`.
- Penyimpanan, analisis, dan retrieval data repost tersebut secara pribadi.
- Chatbot & dashboard untuk konsumsi insight oleh pemilik akun sendiri.

**Out of scope (keputusan sadar pemilik proyek):**

- Aspek legal/compliance terkait Terms of Service Instagram maupun regulasi perlindungan data pribadi (mis. UU PDP) atas data follower yang di-scrape. Ini dicatat sebagai batasan dokumentasi eksplisit, bukan rekomendasi — dianggap di luar cakupan karena proyek bersifat riset personal.
- Multi-user, monetisasi, atau distribusi ke pihak lain.
- Dukungan platform sosial media selain Instagram.

## 6. Proses Bisnis: As-Is vs To-Be

| Aspek                           | As-Is (sekarang)                                                  | To-Be (setelah RepostInsight)                               |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Cara mengetahui minat follower  | Tidak ada proses formal; sesekali lihat repost manual secara acak | Insight tersedia kapan saja lewat chat & dashboard          |
| Skala data yang bisa dianalisis | Praktis nol (mustahil manual pada ribuan follower)                | Seluruh follower yang berhasil di-scrape (target 10rb–15rb) |
| Kecepatan mendapat insight      | Tidak terukur / tidak pernah terjadi secara sistematis            | Instan via chatbot begitu data & embedding tersedia         |

## 7. Metrik Keberhasilan

Karena proyek personal tanpa KPI bisnis formal, keberhasilan diukur kualitatif:

- Sistem berhasil menyelesaikan scraping seluruh (atau mayoritas) daftar follower tanpa kehilangan progres meski proses berulang kali di-pause/dilanjutkan.
- Chatbot mampu menjawab pertanyaan analitik ("topik apa yang lagi ramai?", "akun apa paling sering di-repost?") dengan jawaban relevan, termasuk dalam bentuk grafik saat diminta.
- Dashboard menyajikan gambaran tren repost yang benar-benar dipakai/dicek secara rutin oleh pemilik.

## 8. Asumsi & Batasan Bisnis

| #   | Asumsi/Batasan                                                    | Catatan                                                                                                                           |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Budget operasional Rp0                                            | Mengandalkan saldo gratis bulanan dari beberapa akun Apify (fitur rotasi multi API-key), dan model gratis (`:free`) di OpenRouter |
| A2  | Timeline santai, tanpa deadline keras                             | Pengerjaan fleksibel sesuai waktu luang, dibantu Claude Code                                                                      |
| A3  | Kebijakan tier gratis Apify/OpenRouter bisa berubah sewaktu-waktu | Di luar kendali proyek — risiko diterima                                                                                          |
| A4  | Skala data: 10.000–15.000 follower                                | Menentukan estimasi kebutuhan resource & waktu total scraping                                                                     |
| A5  | Hardware pengembangan: laptop Windows, Intel i5 gen-7, RAM 8GB    | Membatasi pilihan arsitektur teknis (lihat SRS)                                                                                   |

## 9. Analisis Risiko Bisnis

| Risiko                                                                   | Kemungkinan                          | Dampak                                           | Mitigasi                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Saldo gratis Apify per akun tidak cukup untuk 10-15rb follower × 20 post | Tinggi                               | Sedang — scraping jadi lambat, bukan gagal total | Fitur rotasi multi API-key (lihat SRS F3); realistiskan ekspektasi waktu total di Grand Plan                   |
| Instagram mengubah struktur data / actor Apify berhenti berfungsi        | Sedang                               | Tinggi — scraping terhenti total                 | Data yang sudah terkumpul tetap tersimpan (retensi selamanya); actor bisa diganti tanpa mengubah skema DB inti |
| Model gratis OpenRouter dihentikan/diubah kuotanya                       | Sedang                               | Sedang                                           | Nama model dibaca dari konfigurasi/env, bukan hardcode — mudah diganti                                         |
| Data terus bertambah tanpa retensi (disimpan selamanya)                  | Tinggi (pasti terjadi seiring waktu) | Rendah (jangka pendek), Sedang (jangka panjang)  | Perlu dipantau manual oleh pemilik; disk laptop tidak dispesifikasikan dalam requirement ini (asumsi terbuka)  |
| Hardware terbatas (8GB RAM) memperlambat proses bersamaan                | Sedang                               | Sedang                                           | Desain teknis konservatif (concurrency rendah, tanpa Redis, dsb — lihat SRS §Non-Functional)                   |

## 10. Pertimbangan Biaya

- **Budget resmi**: Rp0. Tidak ada anggaran uang tunai dialokasikan.
- **Sumber daya gratis yang dimanfaatkan**: saldo gratis bulanan beberapa akun Apify (via fitur rotasi multi API-key), model `:free` di OpenRouter untuk embedding & chat.
- **Trade-off yang diterima**: karena mengandalkan tier gratis, throughput scraping akan lebih lambat dibanding jika berbayar penuh — ini trade-off sadar demi menjaga budget Rp0, bukan kekurangan yang perlu "diperbaiki".
- **Investasi non-moneter**: waktu development & pemeliharaan oleh pemilik sendiri, dibantu Claude Code untuk mempercepat implementasi teknis.

## 11. Persetujuan

Karena hanya ada satu stakeholder (pemilik proyek merangkap pengguna & developer), dokumen ini dianggap disetujui begitu pemilik proyek menyepakatinya sebagai baseline pengerjaan. Revisi dapat dilakukan kapan saja seiring temuan baru selama pengembangan.
