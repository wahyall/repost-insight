# RepostInsight — Fitur Tambahan: Deskripsi Visual Konten (Gambar & Video)

| | |
|---|---|
| **Dokumen** | Spesifikasi Fitur Tambahan (addendum) |
| **Proyek** | RepostInsight |
| **Versi** | 1.1 — tambah thumbnail sebagai sumber video & caption sebagai konteks |
| **Tanggal** | 24 September 2026 |
| **Melengkapi** | `SRS.md` (F10 baru), `GRAND_PLAN.md` (Fase 8 baru) |

## 1. Ringkasan & Rationale

Saat ini konten yang di-embed untuk RAG hanya `caption_text` + `hashtags`. Banyak post repost captionnya minim atau tidak relevan dengan isi visual sebenarnya, sehingga retrieval semantik kurang akurat. Fitur ini menambahkan **deskripsi visual** hasil analisis gambar/video oleh vision model, digabung ke teks yang di-embed.

- Untuk foto: describe gambar langsung (1 panggilan vision model).
- Untuk carousel: describe **seluruh slide gambar** (semua item dalam `carousel_media`) secara berurutan dalam satu panggilan multi-image vision model komprehensif, mencakup alur konten dan detail visual tiap slide.
- Untuk video (reel): describe **thumbnail/cover** (1 panggilan) DAN **3-5 frame merata dari durasi video** (beberapa panggilan), lalu gabungkan semuanya jadi satu deskripsi koheren lewat panggilan LLM tambahan. Thumbnail disertakan karena itu adalah frame yang "dipilih" (oleh Instagram/pemilik konten) sebagai representasi visual utama — sering kali lebih representatif daripada frame acak di tengah durasi, jadi melengkapi (bukan menggantikan) sampling merata.
- Untuk **semua** panggilan vision model (foto, carousel, thumbnail, maupun tiap frame video), caption asli postingan disertakan sebagai **konteks tambahan** — bukan untuk diulang, tapi membantu model menginterpretasi apa yang dilihatnya (misal nama tempat/acara/orang yang disebut di caption bisa mendisambiguasi objek visual yang ambigu). Model tetap diminta fokus mendeskripsikan detail visual yang belum disebut di caption, supaya hasilnya menambah informasi, bukan mengulang.

## 2. Functional Requirements (F10 — pelengkap SRS.md §3)

- **FR-10.1**: Setiap post foto memanggil vision model terhadap gambar utama (`image_versions.items[0].url`). Untuk post carousel, seluruh slide (`carousel_media`) diunduh dan diproses via multi-image vision model berurutan untuk menghasilkan deskripsi visual yang menyeluruh untuk seluruh rangkaian slide, dengan `caption_text` disertakan sebagai konteks di prompt, menghasilkan `visual_description`.
- **FR-10.2**: Setiap post video memanggil vision model untuk: (a) thumbnail/cover (`thumbnail_url`, fallback `image_versions.additional_items.first_frame.url`), dan (b) N frame yang diekstrak merata dari durasi video (N = 3, 4, atau 5 tergantung durasi — lihat §4). Seluruh panggilan ini menyertakan `caption_text` sebagai konteks. Hasilnya digabung lewat satu panggilan LLM tambahan (yang juga diberi caption) jadi satu `visual_description`.
- **FR-10.3**: Proses ini dijalankan **segera setelah find-or-create post** di siklus scraping yang sama (bukan antrean terpisah yang bisa tertunda lama) karena URL media Instagram kedaluwarsa (parameter `oe=`) dalam 1-2 hari.
- **FR-10.4**: Begitu `visual_description` terisi/berubah, `embedding_status` post terkait di-reset ke `'pending'` agar embedding worker yang sudah ada meng-embed ulang teks gabungan (caption + hashtag + deskripsi visual).
- **FR-10.5**: Kegagalan mengambil sebagian sumber (thumbnail gagal, atau sebagian frame waktu gagal) tidak menggagalkan seluruh proses — deskripsi tetap disusun dari sumber yang berhasil, minimal satu sumber (thumbnail ATAU salah satu frame) berhasil.
- **FR-10.6**: Kegagalan total (URL video/gambar sudah 404/expired) menandai `visual_description_status = 'failed'` tanpa retry berulang — diterima sebagai keterbatasan (lihat SRS §12), bukan bug yang dikejar.
- **FR-10.7**: File video & frame yang diunduh/diekstrak sementara (`/tmp`) selalu dibersihkan setelah proses selesai, sukses maupun gagal.
- **FR-10.8**: Jika `caption_text` kosong/null, blok konteks caption dihilangkan dari prompt (bukan dikirim string kosong).

## 3. Perubahan Data Model (pelengkap SRS.md §4)

Tidak ada perubahan dari versi sebelumnya — kolom yang sama masih dipakai:

```sql
ALTER TABLE posts ADD COLUMN visual_description text;
ALTER TABLE posts ADD COLUMN visual_description_status text NOT NULL DEFAULT 'pending';
-- nilai: pending / done / failed / skipped
```

## 4. Algoritma Sumber Visual

**Foto/carousel**: 1 sumber (gambar utama).

**Video**: total **N + 1 sumber**:
- 1 thumbnail/cover (tidak butuh download video maupun ekstraksi — langsung dari URL yang sudah ada di data scraping)
- N frame waktu, diambil di **titik tengah tiap segmen** (bukan tepat di awal/akhir durasi) supaya tidak kena frame transisi/fade yang sering hitam atau blur:

```
frame ke-i (i = 1..N), dari total N frame:
  timestamp_i = duration * (i - 0.5) / N
```

Jumlah frame waktu (N, di luar thumbnail) mengikuti durasi:

| Durasi video | Jumlah frame waktu (N) | Total sumber (thumbnail + N) |
|---|---|---|
| < 15 detik | 3 | 4 |
| 15-45 detik | 4 | 5 |
| > 45 detik | 5 | 6 |

**Contoh** — video berdurasi 54,97 detik (N=5, total 6 sumber): thumbnail + frame pada ≈ 5.5s, 16.5s, 27.5s, 38.5s, 49.5s.

## 5. Dependency Baru

- **`ffmpeg-static`** (npm) — membawa binary ffmpeg siap pakai, menghindari instalasi ffmpeg manual di Windows. Ditambahkan ke `apps/worker/package.json`.

```bash
pnpm --filter worker add ffmpeg-static
```

## 6. Alur Kerja Lengkap

### 6.1 Gambar/Carousel (single call, dengan konteks caption)

```ts
async function describeImagePost(post: Post): Promise<string> {
  const imageUrl = pickCoverImageUrl(post); // item pertama image_versions / carousel_media
  return describeImage(imageUrl, imagePrompt(post.captionText));
}
```

### 6.2 Video (thumbnail + multi-frame + gabungan, dengan konteks caption)

```ts
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { pipeline } from 'stream/promises';

const execFileAsync = promisify(execFile);

function frameCountFor(duration: number): number {
  if (duration < 15) return 3;
  if (duration <= 45) return 4;
  return 5;
}

async function describeVideoPost(post: Post): Promise<string> {
  const duration = post.videoDuration; // sudah tersedia dari data scraping
  const caption = post.captionText;
  const n = frameCountFor(duration);
  const videoPath = `/tmp/${post.id}.mp4`;
  const framePaths: string[] = [];
  const frameDescriptions: { t: number; desc: string }[] = [];
  let thumbnailDesc: string | null = null;

  // 0. Describe thumbnail dulu — tidak butuh download video, jadi jalan duluan & independen
  try {
    const thumbnailUrl = post.thumbnailUrl ?? post.firstFrameUrl;
    thumbnailDesc = await describeImage(thumbnailUrl, thumbnailPrompt(caption));
  } catch (e) {
    thumbnailDesc = null; // lanjut, jangan gagalkan seluruh proses (FR-10.5)
  }

  try {
    // 1. Download video sekali (lebih hemat daripada seek berulang lewat network)
    const res = await fetch(post.videoUrl);
    await pipeline(res.body as any, (await fs.open(videoPath, 'w')).createWriteStream());

    // 2. Ekstrak & describe tiap frame waktu
    for (let i = 1; i <= n; i++) {
      const t = (duration * (i - 0.5)) / n;
      const framePath = `/tmp/${post.id}_f${i}.jpg`;
      try {
        await execFileAsync(ffmpegPath!, [
          '-ss', t.toFixed(2),
          '-i', videoPath,
          '-frames:v', '1',
          '-q:v', '3',
          '-vf', 'scale=640:-1',
          '-y', framePath,
        ]);
        framePaths.push(framePath);
        const desc = await describeImage(framePath, framePrompt(t, duration, caption), { local: true });
        frameDescriptions.push({ t, desc });
      } catch (e) {
        continue; // lewati frame yang gagal, lanjut ke frame berikutnya (FR-10.5)
      }
      await sleep(1500); // jaga rate limit OpenRouter free tier
    }

    if (!thumbnailDesc && frameDescriptions.length === 0) {
      throw new Error('semua sumber gagal (thumbnail & frame)');
    }

    // 3. Gabungkan thumbnail + frame waktu + caption jadi satu deskripsi koheren
    return await combineDescriptions(thumbnailDesc, frameDescriptions, duration, caption);
  } finally {
    // 4. Bersihkan file sementara (FR-10.7)
    await fs.rm(videoPath, { force: true });
    await Promise.all(framePaths.map((p) => fs.rm(p, { force: true })));
  }
}
```

## 7. Prompt Templates

Helper bersama untuk menyisipkan konteks caption (FR-10.8 — hilangkan blok kalau caption kosong):

```ts
function captionContext(caption?: string | null): string {
  if (!caption?.trim()) return '';
  return `Caption asli postingan ini (gunakan sebagai konteks untuk memahami apa yang kamu lihat, ` +
    `misal nama tempat/acara/orang yang disebut — JANGAN sekadar mengulangnya):\n"${caption.trim()}"\n\n`;
}
```

### 7.1 Prompt gambar/carousel tunggal

```ts
function imagePrompt(caption?: string | null): string {
  return `${captionContext(caption)}Deskripsikan GAMBAR postingan Instagram ini dalam 2-3 kalimat
Bahasa Indonesia. Fokus ke detail visual yang BELUM disebutkan di caption: subjek, aktivitas,
teks yang terlihat di gambar (jika ada), dan suasana.`;
}
```

### 7.2 Prompt thumbnail video

```ts
function thumbnailPrompt(caption?: string | null): string {
  return `${captionContext(caption)}Ini adalah thumbnail/cover yang dipilih untuk sebuah video
Instagram Reels — representasi visual utama dari video tersebut. Deskripsikan dalam 1-2 kalimat
Bahasa Indonesia: subjek, aktivitas, teks di layar jika ada. Fokus ke detail visual yang belum
disebut di caption.`;
}
```

### 7.3 Prompt per-frame video (waktu tertentu)

```ts
function framePrompt(t: number, duration: number, caption?: string | null): string {
  return `${captionContext(caption)}Ini adalah salah satu cuplikan (frame) dari sebuah video
Instagram Reels, diambil pada detik ke-${t.toFixed(1)} dari total durasi ${duration.toFixed(1)} detik.
Deskripsikan secara singkat (1-2 kalimat, Bahasa Indonesia) apa yang terlihat di frame ini secara
visual — subjek, aktivitas, teks di layar jika ada. Jangan berspekulasi tentang bagian video yang
tidak terlihat di frame ini, dan jangan sekadar mengulang caption.`;
}
```

### 7.4 Prompt penggabungan (thumbnail + semua frame + caption)

```ts
function buildCombinePrompt(
  thumbnailDesc: string | null,
  frames: { t: number; desc: string }[],
  duration: number,
  caption?: string | null,
): string {
  const sources = [
    ...(thumbnailDesc ? [`- Thumbnail/cover: ${thumbnailDesc}`] : []),
    ...frames.map((f) => `- Detik ${f.t.toFixed(1)}: ${f.desc}`),
  ].join('\n');

  return `${captionContext(caption)}Berikut deskripsi dari thumbnail dan ${frames.length} cuplikan/frame
yang diambil merata dari sebuah video Instagram Reels berdurasi ${duration.toFixed(1)} detik:

${sources}

Berdasarkan potongan-potongan di atas (dan caption asli, jika ada), buat SATU deskripsi utuh dan
koheren (3-5 kalimat, Bahasa Indonesia) tentang isi video ini secara keseluruhan. Fokus ke: tema/topik
utama, aktivitas yang berlangsung, perubahan/progres jika terlihat dari satu frame ke frame berikutnya,
dan suasana. Jangan sebut kata "frame"/"cuplikan"/"thumbnail" dalam deskripsi akhir, dan jangan sekadar
mengulang caption — tulis seolah kamu menonton videonya secara utuh.`;
}
```

Panggilan penggabungan ini cukup pakai chat completion teks biasa (tanpa gambar), jadi lebih ringan/cepat dibanding panggilan per-sumber visual.

## 8. Pertimbangan Non-Functional

- **Multiplikasi panggilan API**: 1 post video kini butuh 1 (thumbnail) + N (3-5) frame + 1 gabungan = **5-7 panggilan LLM per video**, dibanding foto yang cuma 1 (dengan caption). Ini memperberat beban rate-limit tier gratis OpenRouter secara signifikan untuk konten video — beri jeda antar panggilan (±1.5 detik, lihat kode §6.2) dan pertimbangkan memproses video dengan prioritas lebih rendah/lebih lambat dibanding foto jika volume video tinggi.
- **Bandwidth & disk sementara**: setiap post video butuh download penuh file mp4-nya ke `/tmp` sebelum ekstraksi frame (thumbnail sendiri tidak butuh ini). Pastikan file sementara selalu dihapus (FR-10.7).
- **CPU**: ekstraksi frame via ffmpeg ringan (cuma seek + snapshot), aman untuk hardware i5 gen-7, tapi tetap proses satu video pada satu waktu mengingat RAM 8GB.
- **Panjang prompt**: menyertakan caption di tiap panggilan menambah sedikit token input, tapi Free Models Router punya context window 200rb token — jauh dari batas, tidak perlu truncation caption di tahap ini. Tahap embedding sendiri kini juga longgar (model `nvidia/llama-nemotron-embed-vl-1b-v2:free` berkonteks 131K token — lihat SRS §7 F5), jadi teks gabungan caption+hashtag+`visual_description` yang lebih panjang bukan lagi masalah seperti sebelumnya.

## 9. Batasan & Risiko

- URL video/thumbnail tetap kedaluwarsa dalam 1-2 hari (sama seperti gambar, lihat SRS §12) — proses ini tetap harus jalan secepat mungkin setelah scraping.
- Karena hanya mengambil beberapa titik visual (bukan analisis audio/gerakan penuh), video dengan narasi yang sangat bergantung pada suara (misal voice-over tanpa teks di layar) tidak akan tertangkap dalam deskripsi. Transkripsi audio (mis. lewat model speech-to-text) adalah kemungkinan pengembangan lanjutan di luar scope saat ini.
- Menyertakan caption sebagai konteks berisiko membuat model "malas" dan cuma merangkum ulang caption alih-alih benar-benar mendeskripsikan visual — prompt sudah eksplisit melarang ini (lihat §7), tapi kualitas hasil tetap perlu dicek manual di beberapa sampel awal Fase 8 sebelum dianggap final.
