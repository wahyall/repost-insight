import { prisma } from "@repostinsight/db";
import { getNextActiveApifyKey, handleKeyError } from "./keyRotation";
import { callChatCompletion } from "./visualDescriber";

export const DEFAULT_COMMENT_ACTOR_ID =
  process.env.APIFY_COMMENT_ACTOR_ID || "louisdeconinck~instagram-comments-scraper";
export const DEFAULT_MAX_COMMENTS = 15;
const LOOP_INTERVAL_MS = 3000;

/**
 * Normalisasi teks komentar untuk deteksi duplikat: lowercase, buang emoji/simbol,
 * rapikan spasi. "Alasanku", "alasanku", "alasanku🙌" semua jadi "alasanku".
 */
export function normalizeCommentText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FR-11.10 — buang grup komentar yang teksnya (setelah normalisasi) muncul >= dupThreshold
 * kali dalam satu post. Ini menangkap pola engagement-bait ("komen alasanku maka aku kirim
 * link") tanpa perlu daftar frasa spesifik — bait selalu menghasilkan banyak orang mengetik
 * teks yang nyaris identik, siapa pun captionnya.
 */
export function filterLowSignalComments<T extends { text?: string | null }>(
  comments: T[],
  dupThreshold = 3
): T[] {
  const groups = new Map<string, T[]>();
  for (const c of comments) {
    if (!c.text) continue;
    const key = normalizeCommentText(c.text);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const filtered: T[] = [];
  for (const c of comments) {
    if (!c.text) continue;
    const key = normalizeCommentText(c.text);
    const count = key ? groups.get(key)?.length ?? 0 : 0;
    if (count >= dupThreshold) {
      continue; // Buang komentar bait berulang
    }
    filtered.push(c);
  }
  return filtered;
}

/**
 * Buat prompt rangkuman komentar audiens untuk LLM teks (FR-11.4).
 */
export function buildCommentSummaryPrompt(
  caption: string | null,
  comments: Array<{ text?: string | null; comment_like_count?: number | null; likeCount?: number | null }>
): string {
  const list = comments
    .map(
      (c, i) =>
        `${i + 1}. [${c.comment_like_count ?? c.likeCount ?? 0} suka] ${c.text || "(tanpa teks)"}`
    )
    .join("\n");

  return `Berikut caption asli: "${caption ?? "(tidak ada caption)"}"

Berikut komentar pada postingan ini, diurutkan dari yang paling banyak disukai:
${list}

Rangkum dalam 3-5 kalimat Bahasa Indonesia: keresahan, kritik, atau saran apa yang paling
sering muncul atau paling banyak didukung (dilihat dari jumlah suka)? Kalau sebagian besar
cuma pujian/emoji tanpa substansi, sebutkan itu saja singkat — jangan mengada-ada.`;
}

export interface ScrapeCommentResult {
  success: boolean;
  status: "done" | "skipped" | "failed";
  commentsCount: number;
  summary: string | null;
  error?: string;
}

/**
 * Scrape komentar untuk sebuah post unik (FR-11.1–FR-11.10).
 */
export async function scrapeCommentsForPost(
  postId: string,
  options?: {
    maxComments?: number;
    actorId?: string;
  }
): Promise<ScrapeCommentResult> {
  const maxComments = options?.maxComments ?? DEFAULT_MAX_COMMENTS;
  const actorId = options?.actorId ?? DEFAULT_COMMENT_ACTOR_ID;

  // 1. Ambil data post
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      code: true,
      captionText: true,
      commentCount: true,
      commentsStatus: true,
      rawJson: true,
    },
  });

  if (!post) {
    return {
      success: false,
      status: "failed",
      commentsCount: 0,
      summary: null,
      error: `Post ${postId} tidak ditemukan di database.`,
    };
  }

  // 2. FR-11.2: Post dengan comment_count = 0 langsung 'skipped' tanpa memanggil actor
  const rawObj = (post.rawJson as Record<string, unknown> | null) ?? {};
  const isCommentsDisabled = Boolean(rawObj.comments_disabled);
  const knownCommentCount =
    post.commentCount ??
    (typeof rawObj.comment_count === "number" ? rawObj.comment_count : null) ??
    (typeof rawObj.commentsCount === "number" ? rawObj.commentsCount : null);

  if (knownCommentCount === 0 || isCommentsDisabled) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        commentsStatus: "skipped",
        commentCount: knownCommentCount ?? 0,
      },
    });
    console.log(
      `[CommentScraper] Post ${post.id} (${post.code ?? "no-code"}) comment_count = 0 / comments_disabled -> skipped (FR-11.2).`
    );
    return {
      success: true,
      status: "skipped",
      commentsCount: 0,
      summary: null,
    };
  }

  // 3. Pastikan ada identifier post (code atau URL)
  const postTarget = post.code
    ? post.code
    : `https://www.instagram.com/p/${post.id}/`;

  // 4. Ambil active Apify key via key rotation (FR-11.7)
  const keyInfo = await getNextActiveApifyKey(actorId);
  if (!keyInfo) {
    const msg = "Tidak ada Apify API Key aktif yang tersedia untuk scraping komentar.";
    console.warn(`[CommentScraper] ${msg}`);
    return {
      success: false,
      status: "failed",
      commentsCount: 0,
      summary: null,
      error: msg,
    };
  }

  const { service, keyId } = keyInfo;

  try {
    console.log(
      `[CommentScraper] Menjalankan actor ${actorId} untuk post ${post.id} (code: ${post.code ?? "n/a"}, target: ${postTarget})...`
    );

    // FR-11.1: panggil actor dengan input { urls: [post.code], maxComments }
    const items = await service.callActor(
      actorId,
      {
        urls: [postTarget],
        maxComments,
      },
      {
        timeoutSecs: 180,
        maxItems: maxComments,
      }
    );

    console.log(
      `[CommentScraper] Berhasil mendapatkan ${items.length} komentar mentah untuk post ${post.id}.`
    );

    // 5. Simpan komentar mentah ke tabel comments (FR-11.1)
    if (items.length > 0) {
      await prisma.comment.createMany({
        data: items
          .filter((c: any) => c && (c.pk || c.id))
          .map((c: any) => ({
            id: String(c.pk || c.id),
            postId: post.id,
            commenterUsername: c.user?.username ?? c.owner?.username ?? null,
            text: typeof c.text === "string" ? c.text : null,
            likeCount:
              typeof c.comment_like_count === "number"
                ? c.comment_like_count
                : typeof c.like_count === "number"
                ? c.like_count
                : 0,
            isRankedComment:
              typeof c.is_ranked_comment === "boolean" ? c.is_ranked_comment : null,
            childCommentCount:
              typeof c.child_comment_count === "number"
                ? c.child_comment_count
                : null,
            commentedAt: c.created_at
              ? new Date(
                  typeof c.created_at === "number"
                    ? c.created_at > 1e11
                      ? c.created_at
                      : c.created_at * 1000
                    : c.created_at
                )
              : null,
          })),
        skipDuplicates: true,
      });
    }

    // 6. FR-11.10: Buang komentar bait (duplikat teks berulang) sebelum rangkuman
    const signalComments = filterLowSignalComments(items);

    // 7. FR-11.3: Urutkan ulang manual berdasarkan like_count DESC
    const topComments = signalComments
      .slice()
      .sort((a: any, b: any) => {
        const likesA = a.comment_like_count ?? a.like_count ?? 0;
        const likesB = b.comment_like_count ?? b.like_count ?? 0;
        return likesB - likesA;
      })
      .slice(0, 15);

    // 8. FR-11.4: Rangkum via LLM jika ada komentar dengan sinyal
    let summary: string | null = null;
    if (topComments.length > 0) {
      try {
        const prompt = buildCommentSummaryPrompt(post.captionText, topComments);
        summary = await callChatCompletion(prompt);
      } catch (llmErr) {
        console.warn(
          `[CommentScraper] Gagal menghasilkan rangkuman LLM untuk post ${post.id}:`,
          llmErr
        );
      }
    }

    // 9. Update post: simpan status, summary, dan picu re-embed jika ada summary (FR-11.5)
    await prisma.post.update({
      where: { id: post.id },
      data: {
        commentSummary: summary,
        commentsStatus: "done",
        ...(summary ? { embeddingStatus: "pending" } : {}),
      },
    });

    console.log(
      `[CommentScraper] Post ${post.id} selesai diproses -> done (${items.length} komentar disimpan, summary: ${summary ? "ada" : "null"}).`
    );

    return {
      success: true,
      status: "done",
      commentsCount: items.length,
      summary,
    };
  } catch (err: any) {
    console.error(`[CommentScraper] Gagal scraping komentar post ${post.id}:`, err?.message || err);

    // Periksa apakah ini auth/quota error Apify
    const handled = await handleKeyError(keyId, err);
    if (handled.rotated) {
      console.warn(`[CommentScraper] Apify key #${keyId} dirotasi karena error: ${err?.message}`);
    }

    // FR-11.8: Kegagalan (post dihapus/private/komentar dimatikan) -> comments_status = 'failed'
    await prisma.post.update({
      where: { id: post.id },
      data: { commentsStatus: "failed" },
    });

    return {
      success: false,
      status: "failed",
      commentsCount: 0,
      summary: null,
      error: err?.message || String(err),
    };
  }
}

/**
 * Memproses batch post pending comment scraping.
 */
export async function processPendingCommentsBatch(
  batchSize = 5,
  shouldStopRef: { stop: boolean } = { stop: false }
): Promise<{ processed: number; done: number; skipped: number; failed: number }> {
  const pendingPosts = await prisma.post.findMany({
    where: { commentsStatus: "pending" },
    take: batchSize,
    orderBy: [
      { commentCount: "desc" },
      { firstSeenAt: "asc" },
    ],
    select: { id: true, code: true, commentCount: true },
  });

  const stats = { processed: 0, done: 0, skipped: 0, failed: 0 };
  if (pendingPosts.length === 0) return stats;

  for (const post of pendingPosts) {
    if (shouldStopRef.stop) break;

    // Cek scrape control pause
    const control = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
    if (control?.isPaused) {
      console.log(`[CommentScraper] Sistem sedang dijeda (${control.pauseReason ?? "manual"}). Menunda.`);
      break;
    }

    const res = await scrapeCommentsForPost(post.id);
    stats.processed++;
    if (res.status === "done") stats.done++;
    else if (res.status === "skipped") stats.skipped++;
    else stats.failed++;

    // Jeda antar post agar tidak membombardir API
    if (!shouldStopRef.stop) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  return stats;
}

/**
 * Loop scraping komentar berkelanjutan (FR-11.6, FR-11.9).
 */
export async function startCommentScrapeLoop(shouldStopRef: { stop: boolean }) {
  console.log("[CommentLoop] Memulai loop scraping komentar post (F11)...");

  while (!shouldStopRef.stop) {
    try {
      const control = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
      if (control?.isPaused) {
        await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
        continue;
      }

      const pendingCount = await prisma.post.count({
        where: { commentsStatus: "pending" },
      });

      if (pendingCount === 0) {
        // Tidak ada post pending, tunggu interval sebelum mengecek lagi
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }

      console.log(`[CommentLoop] Ditemukan ${pendingCount} post pending komentar. Memproses batch...`);
      await processPendingCommentsBatch(5, shouldStopRef);
    } catch (err) {
      console.error("[CommentLoop] Error pada siklus comment scraping:", err);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log("[CommentLoop] Loop scraping komentar dihentikan.");
}
