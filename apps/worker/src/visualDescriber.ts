import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import path from "path";
import os from "os";
import { openRouterFetch } from "./openrouterKeyRotation";

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

// ─── Vision model call ────────────────────────────────────────────────────────

function getVisionModel(): string {
  return process.env.OPENROUTER_VISION_MODEL || "openrouter/free";
}

/**
 * Memanggil vision model via OpenRouter dengan sebuah gambar (URL publik atau base64 lokal).
 * @param imageSource  URL publik atau path lokal (file:// akan dibaca, di-base64, dikiriim sebagai data URL)
 * @param prompt       Prompt teks
 * @param opts         { local: true } jika imageSource adalah path lokal
 */
async function callVisionModel(
  imageSource: string,
  prompt: string,
  opts: { local?: boolean } = {},
): Promise<string> {
  let imageContent: { type: string; image_url: { url: string } };

  if (opts.local) {
    // Baca file lokal, encode ke base64
    const buf = await fs.readFile(imageSource);
    const b64 = buf.toString("base64");
    imageContent = {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    };
  } else {
    imageContent = {
      type: "image_url",
      image_url: { url: imageSource },
    };
  }

  const primaryModel = getVisionModel();
  const modelsToTry = [primaryModel];
  if (primaryModel !== "openrouter/free") {
    modelsToTry.push("openrouter/free");
  }

  let lastErr: Error | null = null;
  for (const model of modelsToTry) {
    try {
      const body = JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [imageContent, { type: "text", text: prompt }],
          },
        ],
        max_tokens: 400,
      });

      const res = await openRouterFetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "HTTP-Referer": "https://repostinsight.local",
            "X-Title": "RepostInsight",
          },
          body,
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Vision model [${model}] error [${res.status}]: ${errText}`);
      }

      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      if (text.trim()) {
        return text.trim();
      }
    } catch (err: any) {
      console.warn(`[VisualDescriber] Panggilan ke model ${model} gagal:`, err.message);
      lastErr = err;
    }
  }

  throw lastErr || new Error("Gagal memanggil seluruh kandidat vision model");
}

/**
 * Memanggil chat completion biasa (tanpa gambar) — untuk langkah gabungan video (FR-10.2).
 */
async function callChatCompletion(prompt: string): Promise<string> {
  const chatModel = process.env.OPENROUTER_CHAT_MODEL || "openrouter/free";

  const body = JSON.stringify({
    model: chatModel,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 600,
  });

  const res = await openRouterFetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "HTTP-Referer": "https://repostinsight.local",
        "X-Title": "RepostInsight",
      },
      body,
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat model error [${res.status}]: ${errText}`);
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return text.trim();
}

// ─── Algoritma frame (VISUAL_DESCRIPTION.md §4) ──────────────────────────────

function frameCountFor(durationSec: number): number {
  if (durationSec < 15) return 3;
  if (durationSec <= 45) return 4;
  return 5;
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
      await sleep(1500); // rate-limit tier gratis
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
        await sleep(1500); // rate-limit
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
    const combined = await callChatCompletion(combinePrompt);
    return combined;
  } finally {
    // 4. Bersihkan file sementara (FR-10.7)
    await fs.rm(videoPath, { force: true });
    await Promise.all(framePaths.map((p) => fs.rm(p, { force: true })));
  }
}

// ─── Fungsi publik utama ──────────────────────────────────────────────────────

type MediaTypeCategory = "image" | "video" | "skip";

function categorizeMediaType(
  mediaType: string | null,
  rawJson?: Record<string, unknown> | null,
): MediaTypeCategory {
  // Cek numeric media_type Instagram (1 = photo, 2 = video/reel, 8 = carousel)
  if (mediaType === "1" || mediaType === "8") return "image";
  if (mediaType === "2") return "video";

  if (mediaType) {
    const t = mediaType.toLowerCase().trim();
    if (t === "1" || t === "8") return "image";
    if (t === "2") return "video";
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
      t.includes("carousel") ||
      t.includes("sidecar") ||
      t.includes("album") ||
      t.includes("feed")
    ) {
      return "image";
    }
  }

  // Fallback: cek properti raw_json jika mediaType belum jelas
  if (rawJson) {
    const raw = rawJson as any;
    if (
      raw.is_video === true ||
      raw.video_versions ||
      raw.video_url ||
      raw.product_type === "clips"
    ) {
      return "video";
    }
    if (raw.carousel_media || raw.image_versions || raw.thumbnail_url) {
      return "image";
    }
  }

  return "skip";
}

/**
 * Entry-point utama: describe sebuah post (foto atau video) dan kembalikan deskripsinya.
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

  // image / carousel
  return describeImagePost(post);
}
