import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

// ffmpeg-static mengembalikan path binary atau null jika tidak tersedia
let ffmpegPath: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ffmpegPath = require("ffmpeg-static") as string | null;
} catch {
  console.warn(
    "[VisualDescriber] ffmpeg-static tidak ditemukan. Deskripsi frame video tidak akan tersedia.",
  );
}

// ─── Helpers prompt (VISUAL_DESCRIPTION.md §7) ───────────────────────────────

function captionContext(caption?: string | null): string {
  if (!caption?.trim()) return "";
  return (
    `Caption asli postingan ini (gunakan sebagai konteks untuk memahami apa yang kamu lihat, ` +
    `misal nama tempat/acara/orang yang disebut — JANGAN sekadar mengulangnya):\n"${caption.trim()}"\n\n`
  );
}

function imagePrompt(caption?: string | null): string {
  return (
    `${captionContext(caption)}Deskripsikan GAMBAR postingan Instagram ini dalam 2-3 kalimat ` +
    `Bahasa Indonesia. Fokus ke detail visual yang BELUM disebutkan di caption: subjek, aktivitas, ` +
    `teks yang terlihat di gambar (jika ada), dan suasana.`
  );
}

function carouselPrompt(slideCount: number, caption?: string | null): string {
  return (
    `${captionContext(caption)}Ini adalah postingan carousel Instagram yang terdiri dari ${slideCount} slide berurutan.\n` +
    `Deskripsikan isi visual dari SELURUH slide carousel ini secara komprehensif dalam Bahasa Indonesia.\n` +
    `Sebutkan poin visual penting atau ringkasan alur/konten dari setiap slide (Slide 1 sampai Slide ${slideCount}), serta tema keseluruhan postingan.\n` +
    `Fokus pada detail visual, teks penting di dalam gambar, dan pesan yang disampaikan di setiap slide yang belum lengkap di caption.`
  );
}

function thumbnailPrompt(caption?: string | null): string {
  return (
    `${captionContext(caption)}Ini adalah thumbnail/cover yang dipilih untuk sebuah video ` +
    `Instagram Reels — representasi visual utama dari video tersebut. Deskripsikan dalam 1-2 kalimat ` +
    `Bahasa Indonesia: subjek, aktivitas, teks di layar jika ada. Fokus ke detail visual yang belum ` +
    `disebut di caption.`
  );
}

function framePrompt(
  t: number,
  duration: number,
  caption?: string | null,
): string {
  return (
    `${captionContext(caption)}Ini adalah salah satu cuplikan (frame) dari sebuah video ` +
    `Instagram Reels, diambil pada detik ke-${t.toFixed(1)} dari total durasi ${duration.toFixed(1)} detik. ` +
    `Deskripsikan secara singkat (1-2 kalimat, Bahasa Indonesia) apa yang terlihat di frame ini secara ` +
    `visual — subjek, aktivitas, teks di layar jika ada. Jangan berspekulasi tentang bagian video yang ` +
    `tidak terlihat di frame ini, dan jangan sekadar mengulang caption.`
  );
}

function buildCombinePrompt(
  thumbnailDesc: string | null,
  frames: { t: number; desc: string }[],
  duration: number,
  caption?: string | null,
): string {
  const sources = [
    ...(thumbnailDesc ? [`- Thumbnail/cover: ${thumbnailDesc}`] : []),
    ...frames.map((f) => `- Detik ${f.t.toFixed(1)}: ${f.desc}`),
  ].join("\n");

  return (
    `${captionContext(caption)}Berikut deskripsi dari thumbnail dan ${frames.length} cuplikan/frame ` +
    `yang diambil merata dari sebuah video Instagram Reels berdurasi ${duration.toFixed(1)} detik:\n\n` +
    `${sources}\n\n` +
    `Berdasarkan potongan-potongan di atas (dan caption asli, jika ada), buat SATU deskripsi utuh dan ` +
    `koheren (3-5 kalimat, Bahasa Indonesia) tentang isi video ini secara keseluruhan. Fokus ke: tema/topik ` +
    `utama, aktivitas yang berlangsung, perubahan/progres jika terlihat dari satu frame ke frame berikutnya, ` +
    `dan suasana. Jangan sebut kata "frame"/"cuplikan"/"thumbnail" dalam deskripsi akhir, dan jangan sekadar ` +
    `mengulang caption — tulis seolah kamu menonton videonya secara utuh.`
  );
}

// ─── 9Router API helpers ──────────────────────────────────────────────────────

function get9RouterBaseUrl(): string {
  return (process.env.NINEROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
}

function get9RouterApiKey(): string {
  return process.env.NINEROUTER_API_KEY || "";
}

function get9RouterModel(): string {
  return process.env.NINEROUTER_MODEL || process.env.NINEROUTER_VISION_MODEL || "ag/gemini-3-flash";
}

/**
 * Memanggil vision model via 9Router API dengan sebuah gambar (URL publik atau file lokal).
 * @param imageSource  URL publik atau path lokal
 * @param prompt       Prompt teks
 * @param opts         { local: true } jika imageSource adalah path lokal
 */
async function callVisionModel(
  imageSource: string,
  prompt: string,
  opts: { local?: boolean } = {},
): Promise<string> {
  let b64: string;
  let mime = "image/jpeg";

  if (opts.local) {
    const ext = path.extname(imageSource).toLowerCase();
    if (ext === ".png") mime = "image/png";
    else if (ext === ".webp") mime = "image/webp";
    else if (ext === ".gif") mime = "image/gif";
    // Baca file lokal, encode ke base64
    const buf = await fs.readFile(imageSource);
    b64 = buf.toString("base64");
  } else {
    // Unduh gambar dari URL remote, encode ke base64 untuk dikirim ke 9Router
    const imgRes = await fetch(imageSource);
    if (!imgRes.ok) {
      throw new Error(`Gagal mengunduh gambar [${imgRes.status}]: ${imageSource}`);
    }
    const ct = imgRes.headers.get("content-type");
    if (ct && ct.startsWith("image/")) {
      mime = ct.split(";")[0].trim();
    }
    const arrayBuf = await imgRes.arrayBuffer();
    b64 = Buffer.from(arrayBuf).toString("base64");
  }

  const model = get9RouterModel();
  const baseUrl = get9RouterBaseUrl();
  const apiKey = get9RouterApiKey();
  const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${b64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`9Router Vision model [${model}] error [${res.status}]: ${errText}`);
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (text.trim()) {
    return text.trim();
  }

  throw new Error("Model visual 9Router tidak mengembalikan teks deskripsi.");
}

/**
 * Memanggil vision model via 9Router API dengan beberapa gambar sekaligus (misalnya seluruh slide carousel).
 */
async function callMultiImageVisionModel(
  images: Array<{ b64: string; mime: string }>,
  prompt: string,
): Promise<string> {
  const model = get9RouterModel();
  const baseUrl = get9RouterBaseUrl();
  const apiKey = get9RouterApiKey();
  const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: prompt },
  ];

  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mime};base64,${img.b64}`,
      },
    });
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`9Router Vision model [${model}] error [${res.status}]: ${errText}`);
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (text.trim()) {
    return text.trim();
  }

  throw new Error("Model visual 9Router tidak mengembalikan teks deskripsi.");
}

/**
 * Memanggil chat completion via 9Router (tanpa gambar) — untuk langkah gabungan video (FR-10.2).
 */
async function callChatCompletion(prompt: string): Promise<string> {
  const model = process.env.NINEROUTER_MODEL || process.env.NINEROUTER_CHAT_MODEL || "ag/gemini-3-flash";
  const baseUrl = get9RouterBaseUrl();
  const apiKey = get9RouterApiKey();
  const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`9Router Chat model error [${res.status}]: ${errText}`);
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return text.trim();
}

// ─── Algoritma frame (VISUAL_DESCRIPTION.md §4) ──────────────────────────────

function frameCountFor(durationSec: number): number {
  if (durationSec < 15) return 5;
  if (durationSec <= 45) return 10;
  if (durationSec <= 75) return 15;
  return 20;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Interface Post minimal yang dibutuhkan oleh describer ───────────────────

export interface PostForDescribe {
  id: string;
  mediaType: string | null;
  captionText: string | null;
  rawJson: Record<string, unknown> | null;
}

/**
 * Ekstrak URL gambar utama (foto atau slide pertama carousel) dari raw_json.
 */
function pickCoverImageUrl(post: PostForDescribe): string | null {
  const raw = post.rawJson as Record<string, unknown> | null;
  if (!raw) return null;

  // Coba berbagai field yang umum dikembalikan actor Apify
  const candidates = [
    (raw as any)?.displayUrl,
    (raw as any)?.display_url,
    (raw as any)?.thumbnailUrl,
    (raw as any)?.thumbnail_url,
    (raw as any)?.image_versions?.items?.[0]?.url,
    (raw as any)?.images?.standard_resolution?.url,
    (raw as any)?.carousel_media?.[0]?.image_versions?.items?.[0]?.url,
    (raw as any)?.carousel_media?.[0]?.display_url,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

/**
 * Ekstrak daftar URL gambar untuk setiap slide carousel dari raw_json.
 */
function pickCarouselSlideUrls(post: PostForDescribe): string[] {
  const raw = post.rawJson as Record<string, unknown> | null;
  if (!raw) return [];

  const urls: string[] = [];

  const pickBestSlideUrl = (item: any): string | null => {
    if (!item) return null;
    if (typeof item === "string" && item.startsWith("http")) return item;

    // 1. image_versions (items array) atau image_versions2 (candidates array)
    const items = item.image_versions?.items || item.image_versions2?.candidates;
    if (Array.isArray(items) && items.length > 0) {
      // Prioritaskan resolusi 600-1080px agar transfer cepat, hemat bandwidth & payload, namun tetap tajam
      const med = items.find((x: any) => typeof x?.width === "number" && x.width <= 1080 && x.width >= 600);
      if (med?.url && typeof med.url === "string" && med.url.startsWith("http")) return med.url;

      const under1080 = items.find((x: any) => typeof x?.width === "number" && x.width <= 1080);
      if (under1080?.url && typeof under1080.url === "string" && under1080.url.startsWith("http")) return under1080.url;

      if (items[0]?.url && typeof items[0].url === "string" && items[0].url.startsWith("http")) return items[0].url;
    }

    // 2. Candidate langsung pada item
    const directCandidates = [
      item.thumbnail_url,
      item.thumbnailUrl,
      item.display_url,
      item.displayUrl,
      item.images?.standard_resolution?.url,
      item.url,
      item.imageUrl,
      item.image_url,
    ];

    for (const c of directCandidates) {
      if (typeof c === "string" && c.startsWith("http")) return c;
    }

    return null;
  };

  // 1. Array carousel_media (format standar Instagram Apify)
  if (Array.isArray((raw as any).carousel_media) && (raw as any).carousel_media.length > 0) {
    for (const item of (raw as any).carousel_media) {
      const url = pickBestSlideUrl(item);
      if (url) urls.push(url);
    }
    if (urls.length > 0) return urls;
  }

  // 2. Array images
  if (Array.isArray((raw as any).images) && (raw as any).images.length > 0) {
    for (const item of (raw as any).images) {
      const url = pickBestSlideUrl(item);
      if (url) urls.push(url);
    }
    if (urls.length > 0) return urls;
  }

  // 3. Array sidecarChildren atau childPosts
  const children = (raw as any).sidecarChildren || (raw as any).childPosts;
  if (Array.isArray(children) && children.length > 0) {
    for (const item of children) {
      const url = pickBestSlideUrl(item);
      if (url) urls.push(url);
    }
    if (urls.length > 0) return urls;
  }

  return urls;
}

/**
 * Ekstrak URL thumbnail/cover video dari raw_json.
 */
function pickThumbnailUrl(post: PostForDescribe): string | null {
  const raw = post.rawJson as Record<string, unknown> | null;
  if (!raw) return null;

  const candidates = [
    (raw as any)?.thumbnailUrl,
    (raw as any)?.thumbnail_url,
    (raw as any)?.image_versions?.additional_items?.first_frame?.url,
    (raw as any)?.image_versions?.items?.[0]?.url,
    (raw as any)?.displayUrl,
    (raw as any)?.display_url,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

/**
 * Ekstrak URL video dari raw_json.
 */
function pickVideoUrl(post: PostForDescribe): string | null {
  const raw = post.rawJson as Record<string, unknown> | null;
  if (!raw) return null;

  const candidates = [
    (raw as any)?.videoUrl,
    (raw as any)?.video_url,
    (raw as any)?.video_versions?.[0]?.url,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

/**
 * Ekstrak durasi video (detik) dari raw_json.
 */
function pickVideoDuration(post: PostForDescribe): number {
  const raw = post.rawJson as Record<string, unknown> | null;
  if (!raw) return 30; // fallback aman → ambil 4 frame

  const dur =
    (raw as any)?.videoDuration ??
    (raw as any)?.video_duration ??
    (raw as any)?.duration ??
    null;

  if (typeof dur === "number" && dur > 0) return dur;
  return 30;
}

// ─── Describe foto/carousel (FR-10.1) ────────────────────────────────────────

async function describeImagePost(post: PostForDescribe): Promise<string> {
  const imageUrl = pickCoverImageUrl(post);
  if (!imageUrl) throw new Error("Tidak ada URL gambar yang dapat digunakan.");

  return callVisionModel(imageUrl, imagePrompt(post.captionText));
}

// ─── Describe carousel (FR-10.1 pelengkap: seluruh slide) ───────────────────

async function describeCarouselPost(post: PostForDescribe): Promise<string> {
  const slideUrls = pickCarouselSlideUrls(post);

  // Jika slide hanya 1 atau tidak ditemukan list slide, fallback ke single image post
  if (slideUrls.length <= 1) {
    return describeImagePost(post);
  }

  // Unduh seluruh slide secara concurrent (dengan timeout per request)
  const downloadSlide = async (
    url: string,
    index: number,
  ): Promise<{ index: number; b64: string; mime: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25 detik timeout per slide
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = res.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
      const arrayBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString("base64");
      return { index, b64, mime };
    } finally {
      clearTimeout(timeout);
    }
  };

  const results = await Promise.allSettled(
    slideUrls.map((url, idx) => downloadSlide(url, idx + 1)),
  );

  const successfulSlides: Array<{ index: number; b64: string; mime: string }> = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") {
      successfulSlides.push(res.value);
    } else {
      console.warn(
        `[VisualDescriber] Gagal mengunduh slide ${i + 1} untuk post ${post.id}:`,
        (res.reason as Error)?.message || res.reason,
      );
    }
  });

  // Jika semua slide gagal diunduh, lempar error
  if (successfulSlides.length === 0) {
    throw new Error(`Semua gambar slide carousel gagal diunduh untuk post ${post.id}.`);
  }

  // Urutkan kembali berdasarkan nomor slide aslinya
  successfulSlides.sort((a, b) => a.index - b.index);

  // Jika hanya 1 slide yang berhasil diunduh, gunakan single image prompt
  if (successfulSlides.length === 1) {
    return callMultiImageVisionModel(
      successfulSlides,
      imagePrompt(post.captionText),
    );
  }

  const prompt = carouselPrompt(successfulSlides.length, post.captionText);
  return callMultiImageVisionModel(successfulSlides, prompt);
}

// ─── Describe video (FR-10.2) ────────────────────────────────────────────────

async function describeVideoPost(post: PostForDescribe): Promise<string> {
  const duration = pickVideoDuration(post);
  const caption = post.captionText;
  const n = frameCountFor(duration);
  const tmpDir = os.tmpdir();
  const videoPath = path.join(tmpDir, `repostinsight_${post.id}.mp4`);
  const framePaths: string[] = [];
  const frameDescriptions: { t: number; desc: string }[] = [];
  let thumbnailDesc: string | null = null;

  // 0. Describe thumbnail — tidak butuh download video (VISUAL_DESCRIPTION.md §6.2)
  try {
    const thumbUrl = pickThumbnailUrl(post);
    if (thumbUrl) {
      thumbnailDesc = await callVisionModel(thumbUrl, thumbnailPrompt(caption));
      await sleep(500);
    }
  } catch (e) {
    console.warn(
      `[VisualDescriber] Thumbnail gagal untuk post ${post.id}:`,
      (e as Error).message,
    );
    thumbnailDesc = null; // FR-10.5: lanjutkan
  }

  // Jika ffmpeg tidak tersedia, kembalikan hanya deskripsi thumbnail
  if (!ffmpegPath) {
    if (!thumbnailDesc)
      throw new Error(
        "Thumbnail gagal dan ffmpeg tidak tersedia — tidak ada sumber visual.",
      );
    return thumbnailDesc;
  }

  try {
    // 1. Download video sekali (lebih hemat daripada seek berulang via network)
    const videoUrl = pickVideoUrl(post);
    if (!videoUrl) {
      if (thumbnailDesc) return thumbnailDesc;
      throw new Error(
        "URL video tidak ditemukan dan thumbnail juga tidak ada.",
      );
    }

    const res = await fetch(videoUrl);
    if (!res.ok || !res.body)
      throw new Error(`Gagal download video: HTTP ${res.status}`);

    // Tulis ke file sementara
    const ws = createWriteStream(videoPath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, ws);

    // 2. Ekstrak dan describe tiap frame waktu
    for (let i = 1; i <= n; i++) {
      const t = (duration * (i - 0.5)) / n;
      const framePath = path.join(tmpDir, `repostinsight_${post.id}_f${i}.jpg`);
      framePaths.push(framePath);

      try {
        await execFileAsync(ffmpegPath!, [
          "-ss",
          t.toFixed(2),
          "-i",
          videoPath,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          "-vf",
          "scale=640:-1",
          "-y",
          framePath,
        ]);

        const desc = await callVisionModel(
          framePath,
          framePrompt(t, duration, caption),
          { local: true },
        );
        frameDescriptions.push({ t, desc });
        await sleep(800); // jeda antar frame
      } catch (frameErr) {
        console.warn(
          `[VisualDescriber] Frame ${i} (t=${t.toFixed(1)}s) gagal untuk post ${post.id}:`,
          (frameErr as Error).message,
        );
        // FR-10.5: lewati frame yang gagal, lanjut ke berikutnya
      }
    }

    // FR-10.5: Kalau semua sumber gagal, lempar error
    if (!thumbnailDesc && frameDescriptions.length === 0) {
      throw new Error("Semua sumber visual gagal (thumbnail & semua frame).");
    }

    // 3. Gabungkan thumbnail + frame → satu deskripsi koheren (FR-10.2)
    if (frameDescriptions.length === 0) {
      // Hanya thumbnail berhasil, kembalikan langsung
      return thumbnailDesc!;
    }

    const combinePrompt = buildCombinePrompt(
      thumbnailDesc,
      frameDescriptions,
      duration,
      caption,
    );
    try {
      const combined = await callChatCompletion(combinePrompt);
      if (combined.trim()) {
        return combined.trim();
      }
    } catch (combineErr: any) {
      console.warn(
        `[VisualDescriber] Penggabungan deskripsi chat gagal untuk post ${post.id}:`,
        combineErr.message,
      );
    }

    // Fallback jika callChatCompletion gagal atau kosong: gabungkan deskripsi frame langsung
    const fallbackParts: string[] = [];
    if (thumbnailDesc) fallbackParts.push(`Thumbnail: ${thumbnailDesc}`);
    for (const f of frameDescriptions) {
      fallbackParts.push(`Detik ${f.t.toFixed(1)}: ${f.desc}`);
    }
    return fallbackParts.join(". ");
  } finally {
    // 4. Bersihkan file sementara (FR-10.7)
    await fs.rm(videoPath, { force: true });
    await Promise.all(framePaths.map((p) => fs.rm(p, { force: true })));
  }
}

// ─── Fungsi publik utama ──────────────────────────────────────────────────────

type MediaTypeCategory = "image" | "carousel" | "video" | "skip";

function categorizeMediaType(
  mediaType: string | null,
  rawJson?: Record<string, unknown> | null,
): MediaTypeCategory {
  // 1. Cek jika ada indikasi carousel yang jelas di rawJson
  if (rawJson) {
    const raw = rawJson as any;
    if (
      (Array.isArray(raw.carousel_media) && raw.carousel_media.length > 1) ||
      (Array.isArray(raw.images) && raw.images.length > 1) ||
      (Array.isArray(raw.sidecarChildren) && raw.sidecarChildren.length > 1) ||
      (Array.isArray(raw.childPosts) && raw.childPosts.length > 1) ||
      raw.product_type === "carousel_container"
    ) {
      return "carousel";
    }
  }

  // 2. Cek numeric media_type Instagram (1 = photo, 2 = video/reel, 8 = carousel)
  if (mediaType === "8") return "carousel";
  if (mediaType === "2") return "video";
  if (mediaType === "1") return "image";

  if (mediaType) {
    const t = mediaType.toLowerCase().trim();
    if (t === "8" || t.includes("carousel") || t.includes("sidecar") || t.includes("album")) {
      return "carousel";
    }
    if (
      t.includes("video") ||
      t.includes("reel") ||
      t.includes("clip") ||
      t.includes("igtv")
    ) {
      return "video";
    }
    if (
      t.includes("photo") ||
      t.includes("image") ||
      t.includes("feed")
    ) {
      return "image";
    }
  }

  // 3. Fallback: cek properti raw_json jika mediaType belum jelas
  if (rawJson) {
    const raw = rawJson as any;
    if (Array.isArray(raw.carousel_media) && raw.carousel_media.length > 0) {
      return "carousel";
    }
    if (
      raw.is_video === true ||
      raw.video_versions ||
      raw.video_url ||
      raw.product_type === "clips"
    ) {
      return "video";
    }
    if (raw.image_versions || raw.thumbnail_url || raw.display_url || raw.displayUrl) {
      return "image";
    }
  }

  return "skip";
}

/**
 * Entry-point utama: describe sebuah post (foto, carousel seluruh slide, atau video) dan kembalikan deskripsinya.
 * Dipanggil dari scrapeLoop tepat setelah find-or-create post (FR-10.3).
 *
 * @throws Error jika gagal total — caller harus tangkap dan set visual_description_status = 'failed'
 */
export async function describePost(post: PostForDescribe): Promise<string> {
  const category = categorizeMediaType(post.mediaType, post.rawJson);

  if (category === "skip") {
    throw Object.assign(new Error("Media type tidak dikenali, di-skip."), {
      skip: true,
    });
  }

  if (category === "video") {
    return describeVideoPost(post);
  }

  if (category === "carousel") {
    return describeCarouselPost(post);
  }

  // image
  return describeImagePost(post);
}
