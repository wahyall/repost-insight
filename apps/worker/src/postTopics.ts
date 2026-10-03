import { prisma } from "@repostinsight/db";
import { callChatCompletion } from "./visualDescriber";

const POST_BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000;

/** Daftar topic_label yang sudah dipakai — dari posts maupun hashtag_topics. */
export async function getDistinctTopicLabels(): Promise<string[]> {
  const rows: { topic_label: string }[] = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT topic_label FROM posts WHERE topic_label IS NOT NULL
     UNION
     SELECT DISTINCT topic_label FROM hashtag_topics
     ORDER BY topic_label ASC;`
  );
  return rows.map((r) => r.topic_label).filter(Boolean);
}

/** Peta hashtag -> topic_label untuk jalur cepat (tanpa LLM). */
export async function getHashtagTopicMap(): Promise<Map<string, string>> {
  const rows: { hashtag: string; topic_label: string }[] = await prisma.$queryRawUnsafe(
    `SELECT hashtag, topic_label FROM hashtag_topics;`
  );
  return new Map(rows.map((r) => [r.hashtag, r.topic_label]));
}

function stripCodeFence(text: string): string {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseContentClassificationResponse(raw: string): { id: string; topic_label: string }[] {
  const cleaned = stripCodeFence(raw);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Tidak ditemukan blok JSON array pada respons LLM.");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Respons LLM bukan JSON array.");
  return parsed.filter(
    (p) => p && typeof p.id === "string" && typeof p.topic_label === "string" && p.topic_label.trim()
  );
}

function buildContentClassificationPrompt(
  existingTopics: string[],
  posts: { id: string; captionText: string | null; visualDescription: string | null }[]
): string {
  // Catatan: kolom comment_summary / tabel comments (F11) belum ada di skema,
  // jadi klasifikasi hanya memakai caption + deskripsi visual AI.
  const list = posts
    .map(
      (p, i) =>
        `${i + 1}. [id:${p.id}] Caption: "${p.captionText ?? "-"}" | Deskripsi visual: "${p.visualDescription ?? "-"}"`
    )
    .join("\n");
  return `Berikut daftar topik yang SUDAH ada (pakai ulang kalau cocok):
${existingTopics.map((t) => `- ${t}`).join("\n") || "(belum ada)"}

Berikut post tanpa hashtag/belum ter-mapping, klasifikasikan tiap post ke SATU topik
berdasarkan isi caption/deskripsi visualnya:
${list}

Kalau isi post benar-benar tidak cukup informasi (semua field kosong/"-"), beri
topic_label = "Tidak terklasifikasi" — jangan dipaksakan mengarang topik. Jawab HANYA JSON:
[{"id":"...","topic_label":"..."}]`;
}

export async function refreshTopicDistributionView(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_topic_distribution;`);
  } catch {
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_topic_distribution;`);
    } catch (err) {
      console.warn("[PostTopics] Gagal merefresh mv_topic_distribution:", err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mengisi posts.topic_label untuk seluruh backlog post (self-resuming, aman
 * dipanggil ulang kapan saja). Dua jalur per batch:
 * - Jalur cepat: copy topic dari hashtag yang sudah ter-mapping (tanpa LLM).
 * - Fallback: klasifikasi dari isi konten (caption + deskripsi visual) via LLM.
 * Post yang genuinely tanpa informasi apa pun diberi "Tidak terklasifikasi".
 */
export async function classifyPostTopics(): Promise<void> {
  let existingTopics = await getDistinctTopicLabels();
  const hashtagTopicCache = await getHashtagTopicMap();
  let totalClassified = 0;

  try {
    while (true) {
      const batch = await prisma.post.findMany({
        where: { topicLabel: null },
        take: POST_BATCH_SIZE,
        select: { id: true, hashtags: true, captionText: true, visualDescription: true },
      });
      if (batch.length === 0) break;

      const fastLane: { id: string; topicLabel: string }[] = [];
      const needsContentClassification: typeof batch = [];

      for (const post of batch) {
        const mapped = (post.hashtags ?? [])
          .map((h) => hashtagTopicCache.get(h))
          .find((t) => t && t !== "Lainnya");
        if (mapped) fastLane.push({ id: post.id, topicLabel: mapped });
        else needsContentClassification.push(post);
      }

      try {
        await Promise.all(
          fastLane.map((f) =>
            prisma.post.update({ where: { id: f.id }, data: { topicLabel: f.topicLabel } })
          )
        );
        totalClassified += fastLane.length;

        if (needsContentClassification.length) {
          // Identifikasi post yang benar-benar tanpa informasi
          const emptyInfoPosts = needsContentClassification.filter(
            (p) => (!p.captionText || !p.captionText.trim()) && (!p.visualDescription || !p.visualDescription.trim())
          );
          const hasInfoPosts = needsContentClassification.filter(
            (p) => (p.captionText && p.captionText.trim()) || (p.visualDescription && p.visualDescription.trim())
          );

          if (emptyInfoPosts.length > 0) {
            await Promise.all(
              emptyInfoPosts.map((p) =>
                prisma.post.update({ where: { id: p.id }, data: { topicLabel: "Tidak terklasifikasi" } })
              )
            );
            totalClassified += emptyInfoPosts.length;
          }

          if (hasInfoPosts.length > 0) {
            const raw = await callChatCompletion(
              buildContentClassificationPrompt(existingTopics, hasInfoPosts)
            );
            const parsed = parseContentClassificationResponse(raw);
            const validIds = new Set(hasInfoPosts.map((p) => p.id));
            const valid = parsed.filter((p) => validIds.has(p.id));
            await Promise.all(
              valid.map((p) =>
                prisma.post.update({ where: { id: p.id }, data: { topicLabel: p.topic_label } })
              )
            );
            totalClassified += valid.length;
            existingTopics = [...new Set([...existingTopics, ...valid.map((p) => p.topic_label)])];
            if (valid.length < hasInfoPosts.length) {
              console.warn(
                `[PostTopics] ${hasInfoPosts.length - valid.length} post tidak terklasifikasi LLM di batch ini (tetap NULL, dicoba lagi siklus berikutnya).`
              );
              break;
            }
          }
        }
      } catch (err) {
        console.error(
          "[PostTopics] Gagal mengklasifikasi batch, akan dicoba lagi di siklus berikutnya:",
          err
        );
        break;
      }

      await sleep(BATCH_DELAY_MS);
    }
  } finally {
    console.log(`[PostTopics] Selesai — ${totalClassified} post terklasifikasi sesi ini.`);
    await refreshTopicDistributionView();
  }
}

