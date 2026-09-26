# Prompt: Upgrade Kualitas Chatbot RAG — RepostInsight

Gunakan teks di bawah ini sebagai instruksi langsung ke Claude Code (paste sebagai pesan, atau tunjuk file ini). Ini BUKAN pengganti/bagian dari `docs/SRS.md` dkk — ini task brief berdiri sendiri untuk satu pekerjaan spesifik.

---

## Konteks

Proyek RepostInsight sudah punya chatbot RAG dengan 4 tools yang berfungsi baik: `semantic_search` (pgvector, sudah ada re-ranking similarity+recency), `query_aggregate` (materialized views), `analyze_topics` (distribusi hashtag), dan `render_chart`. File tools ini ada di codebase — cari sendiri lokasinya (kemungkinan di `apps/web/lib/tools/` atau serupa) sebelum mengubah apa pun.

## Tujuan

Tingkatkan **kualitas dan kedalaman jawaban** chatbot supaya senatural dan sepintar chatbot seperti Claude/ChatGPT — mampu bernalar multi-langkah, memahami konteks percakapan, dan menyajikan jawaban dalam format yang bervariasi sesuai kebutuhan. **Prioritaskan kualitas jawaban di atas kecepatan maupun biaya.**

## Tugas

### 1. Cari orchestrator chat completion yang sudah ada

Temukan file yang memanggil LLM dengan `tools` (kemungkinan di route handler `/api/chat`). Periksa: apakah dia sudah melakukan **loop multi-putaran** (panggil tool → kirim hasil balik ke model → model boleh panggil tool lagi → ulangi sampai model kasih jawaban final tanpa tool call), atau cuma satu putaran (panggil tool sekali, langsung jawab)?

Kalau masih satu putaran, ubah jadi loop (maksimal 6 iterasi sebagai pengaman):

```ts
const MAX_ITERATIONS = 6;

export async function runChatAgent(history: ChatMessage[]) {
  const conversation = [...history];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NINEROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.NINEROUTER_CHAT_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...conversation],
        tools: CHATBOT_TOOLS,
        tool_choice: "auto",
        temperature: 0.4,
      }),
    });
    const { choices } = await res.json();
    const msg = choices[0].message;
    conversation.push(msg);

    if (!msg.tool_calls?.length) break;

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      const result = await dispatchTool(call.function.name, args);
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return conversation;
}
```

`dispatchTool` memanggil fungsi `execute*` yang sudah ada di file tools (`executeSemanticSearch`, `executeQueryAggregate`, `executeAnalyzeTopics`, `executeRenderChart`), plus tool baru di langkah 3.

### 2. Tulis ulang system prompt

Ganti/tambahkan system prompt dengan isi berikut (sesuaikan detail teknis kalau ada perbedaan nyata di codebase, tapi pertahankan strukturnya):

```
Kamu adalah asisten analitik RepostInsight — database berisi postingan Instagram yang
di-repost followers @wahy.all, lengkap dengan caption, hashtag, deskripsi visual (AI dari
gambar/video), rangkuman komentar (keresahan/kritik/saran audiens, jika sudah tersedia),
dan siapa saja yang me-repost tiap post. Tujuanmu: bantu evaluasi konten, ide konten baru,
riset kompetitor.

CARA BERPIKIR SEBELUM MENJAWAB:
1. Kalau pertanyaan ambigu dan interpretasinya bisa sangat berbeda hasilnya, tanya balik
   dulu — jangan menebak.
2. Pertanyaan kompleks sering butuh LEBIH DARI SATU tool berurutan (misal analyze_topics
   dulu untuk gambaran besar, baru semantic_search untuk mendalami topik spesifik yang
   muncul, baru get_post_detail untuk contoh konkret).
3. Setelah dapat hasil tool, nilai: sudah cukup untuk jawaban yang benar-benar berguna,
   atau perlu tool lagi? Jangan terburu-buru menjawab dengan data yang tanggung.
4. Kalau hasil kosong/tidak relevan, katakan terus terang — jangan mengarang angka atau
   contoh yang tidak benar-benar ada di hasil tool.

FORMAT JAWABAN — sesuaikan dengan isi, jangan selalu sama bentuknya:
- Pertanyaan faktual sederhana → jawab langsung 1-3 kalimat.
- Perbandingan beberapa akun/topik → tabel markdown.
- Peringkat/top-N → list bernomor.
- Insight dengan beberapa aspek berbeda → subjudul singkat per aspek.
- Merangkum banyak post/komentar → kelompokkan per tema, jangan daftar mentah.
- Sertakan angka konkret dari hasil tool untuk mendukung klaim (jumlah repost, jumlah
  follower unik, dst) — hindari kata "banyak"/"sering" tanpa angka pendukung.
- Kalau menyebut comment_summary/visual_description, ingat itu hasil analisis AI, bukan
  fakta mentah — sebut sumbernya kalau relevan ("berdasarkan analisis komentar...").
```

### 3. Tambah tool baru: `get_post_detail`

Untuk drill-down ke satu post spesifik yang ditemukan lewat `semantic_search`:

```ts
export async function executeGetPostDetail(postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      repostEvents: { select: { followerUsername: true } },
      comments: { orderBy: { likeCount: "desc" }, take: 10 },
    },
  });
  if (!post) return { found: false };
  return {
    found: true,
    captionText: post.captionText,
    visualDescription: post.visualDescription,
    commentSummary: post.commentSummary ?? null,
    topComments: post.comments?.map((c) => ({ text: c.text, likeCount: c.likeCount })) ?? [],
    repostedBy: post.repostEvents.map((r) => r.followerUsername),
  };
}
```

Kalau kolom `comment_summary`/tabel `comments` belum ada di database saat ini (fitur F11 belum diimplementasi), buat tool ini tetap jalan dengan field tersebut bernilai `null`/array kosong — jangan sampai error.

Tambahkan juga schema tool-nya ke array `CHATBOT_TOOLS` yang sudah ada, dengan pola deskripsi yang sama seperti 4 tool lain (jelas kapan dipakai, kapan tidak).

### 4. Pastikan riwayat percakapan penuh dikirim tiap panggilan

Cek apakah orchestrator mengambil seluruh riwayat dari tabel riwayat chat yang ada (bukan cuma pesan terakhir user) sebelum dikirim ke model. Tanpa ini, pertanyaan lanjutan ("terus gimana kalau dibandingin sama akun Y?") akan kehilangan konteks.

### 5. Pastikan UI chat merender markdown

Cek komponen chat di frontend — kalau masih render teks polos (`<p>{message}</p>` atau sejenisnya), tambahkan `react-markdown` + `remark-gfm` (untuk tabel) supaya instruksi format di system prompt (poin 2) benar-benar terlihat, bukan cuma teks markdown mentah.

### 6. Tuning parameter tambahan

- `temperature: 0.4` (atau lebih rendah) — prioritaskan akurasi/grounding di atas kreativitas.
- Jangan set `max_tokens` terlalu kecil — biarkan jawaban selesai sepenuhnya sesuai kebutuhan format (poin 2), bukan terpotong demi hemat.

## Kriteria Selesai

- [x] Orchestrator melakukan loop tool-calling multi-putaran (bukan satu kali panggil-jawab)
- [x] System prompt baru terpasang
- [x] Tool `get_post_detail` ada dan terdaftar di `CHATBOT_TOOLS`
- [x] Riwayat percakapan penuh ikut terkirim tiap panggilan
- [x] Chat UI merender markdown (termasuk tabel)
- [x] Uji manual: ajukan pertanyaan yang butuh >1 tool berurutan (misal "topik apa yang lagi ramai, kasih contoh post-nya dan siapa yang paling banyak repost"), pastikan model memanggil beberapa tool sendiri tanpa diminta bertahap

### 7. PERBAIKAN BUG: distribusi topik bias sampel, bukan data sebenarnya

**Gejala**: pertanyaan seperti "5 topik paling sering dibahas" menghasilkan jawaban dari sampel kecil `semantic_search` (≤15 post per panggilan) yang di-treat model seolah representasi seluruh database — topik langka (misal cuma 3 dari ratusan repost) bisa muncul sebagai "top 5" kalau kebetulan masuk sampel.

**Root cause**: tidak ada tool yang menghitung distribusi TOPIK (kelompok semantik dari beberapa hashtag) secara akurat di seluruh database — `analyze_topics` cuma per-hashtag literal, `semantic_search` cuma sampel kecil berbasis similarity.

**Fix wajib**:
1. Tambah tabel `hashtag_topics` (hashtag → topic_label) dan materialized view `mv_topic_distribution`.
2. Implementasi `reclassifyHashtagTopics()` dengan pola **batch berurutan + kamus topik yang terus bertambah** (bukan satu kali kirim semua hashtag ke LLM) — penting karena scraping sudah berjalan ribuan post, backlog hashtag unik yang belum diklasifikasi bisa ratusan:
   - Ambil hashtag belum terklasifikasi, urut `usage_count DESC`, proses per batch (±60 hashtag/panggilan).
   - Tiap batch diberi daftar topic_label yang SUDAH ada dari batch sebelumnya, supaya model pakai ulang label yang sama alih-alih bikin topik duplikat makna.
   - Hashtag generik/algoritmik (fyp, viral, reels, explore, foryou, dst) diberi label `"Lainnya"`, bukan dipaksa masuk topik tertentu.
   - Loop sampai tidak ada hashtag tersisa yang belum diklasifikasi (self-resuming — aman dipanggil ulang kapan saja, baik untuk backlog besar pertama kali maupun trickle harian).
   - Panggil sekali saat worker start (menuntaskan backlog yang sudah ada), lalu jadwalkan berkala (misal harian) untuk hashtag baru dari scraping berikutnya.
3. Tambah tool baru `get_topic_distribution` yang query `mv_topic_distribution` (akurat, whole-database), dengan deskripsi tool yang EKSPLISIT melarang penggunaan `semantic_search` untuk pertanyaan jenis "topik apa paling sering/dominan".
4. **Perbaiki juga metrik recency di `executeSemanticSearch`**: ganti basis dari `posts.taken_at` (tanggal post asli diunggah di IG) ke `MAX(repost_events.scraped_at)` (kapan data itu benar-benar masuk ke database) — recency yang sekarang salah sasaran, tidak mencerminkan "data mana yang baru di-scrape".

**Kriteria selesai tambahan**:
- [x] `get_topic_distribution` mengembalikan angka yang konsisten dengan hitungan manual di database (uji: query manual `COUNT(*)` untuk satu topik, bandingkan dengan output tool)
- [x] Pertanyaan "topik apa paling sering dibahas" memicu model memanggil `get_topic_distribution`, bukan `semantic_search`
- [x] Topik dengan occurrence rendah (misal <1% dari total) tidak lagi muncul di top-5 kecuali memang benar levelnya
- [x] Backlog hashtag existing (dari ribuan post yang sudah ter-scrape) berhasil terklasifikasi penuh via `reclassifyHashtagTopics()` tanpa perlu script migrasi terpisah — cek `SELECT COUNT(*) FROM mv_trending_hashtags WHERE tag NOT IN (SELECT hashtag FROM hashtag_topics)` hasilnya 0
- [x] Hashtag generik (fyp/viral/reels/dst) masuk kategori "Lainnya", tidak mengotori topik asli

## Batasan

- Jangan ubah pipeline scraping/embedding yang sudah berjalan.
- Jangan hapus atau ganti nama 4 tool yang sudah ada — cuma tambah `get_post_detail`.
- Cari sendiri lokasi file yang relevan di codebase, jangan asumsikan path pasti.
