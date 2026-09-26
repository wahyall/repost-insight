import { prisma } from "@repostinsight/db";
import { callChatCompletion } from "./visualDescriber";

const BATCH_SIZE = 60;

const GENERIC_HASHTAGS = new Set([
  "fyp",
  "fypage",
  "foryou",
  "foryoupage",
  "viral",
  "viralvideo",
  "reels",
  "reelsinstagram",
  "explore",
  "explorepage",
  "trending",
  "instagood",
  "instadaily",
]);

interface UnclassifiedRow {
  tag: string;
  usage_count: number;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseClassificationResponse(raw: string, tags: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const cleaned = stripCodeFence(raw);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Tidak ditemukan blok JSON pada respons LLM.");
    }
    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    for (const tag of tags) {
      const label = parsed[tag];
      result[tag] = typeof label === "string" && label.trim() ? label.trim() : "Lainnya";
    }
  } catch (err) {
    console.warn(
      "[HashtagTopics] Gagal parse respons klasifikasi, fallback seluruh batch ke 'Lainnya':",
      (err as Error).message
    );
    for (const tag of tags) {
      result[tag] = "Lainnya";
    }
  }
  return result;
}

function buildClassificationPrompt(tags: string[], existingLabels: string[]): string {
  const labelSection =
    existingLabels.length > 0
      ? `Berikut daftar topic_label yang SUDAH ada — PAKAI ULANG label ini jika hashtag baru cocok maknanya, JANGAN membuat label baru yang maknanya sama:\n${existingLabels
          .map((l) => `- ${l}`)
          .join("\n")}\n\n`
      : "";

  return (
    `Kamu adalah pengklasifikasi topik hashtag Instagram Bahasa Indonesia untuk sistem riset konten dakwah/komunitas.\n\n` +
    labelSection +
    `Klasifikasikan setiap hashtag berikut ke SATU topic_label singkat (2-4 kata, Bahasa Indonesia, Title Case, misal "Parenting & Keluarga", "Sedekah & Kedermawanan"):\n` +
    tags.map((t) => `- ${t}`).join("\n") +
    `\n\nBalas HANYA dengan satu JSON object valid, key = hashtag PERSIS seperti tertulis di atas (tanpa tanda pagar), value = topic_label. Jangan sertakan penjelasan atau teks lain di luar JSON.`
  );
}

async function classifyHashtagBatch(
  tags: string[],
  existingLabels: string[]
): Promise<Record<string, string>> {
  const genericAssigned: Record<string, string> = {};
  const toClassify: string[] = [];

  for (const tag of tags) {
    if (GENERIC_HASHTAGS.has(tag)) {
      genericAssigned[tag] = "Lainnya";
    } else {
      toClassify.push(tag);
    }
  }

  if (toClassify.length === 0) {
    return genericAssigned;
  }

  const prompt = buildClassificationPrompt(toClassify, existingLabels);
  const raw = await callChatCompletion(prompt);
  const classified = parseClassificationResponse(raw, toClassify);

  return { ...genericAssigned, ...classified };
}

async function refreshTopicDistributionView(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_topic_distribution;`);
  } catch {
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_topic_distribution;`);
    } catch (err) {
      console.warn("[HashtagTopics] Gagal merefresh mv_topic_distribution:", err);
    }
  }
}

/**
 * Mengklasifikasikan seluruh backlog hashtag yang belum punya topic_label, batch demi batch
 * (self-resuming — aman dipanggil ulang kapan saja: backlog besar pertama kali, atau trickle
 * harian dari scraping berikutnya). Setiap batch menuliskan label untuk SEMUA tag di batch itu
 * (termasuk fallback "Lainnya" jika parsing gagal), sehingga loop dijamin maju tiap iterasi.
 */
export async function reclassifyHashtagTopics(): Promise<void> {
  let totalClassified = 0;

  while (true) {
    const existingLabelRows: { topic_label: string }[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT topic_label FROM hashtag_topics ORDER BY topic_label ASC;`
    );
    const existingLabels = existingLabelRows.map((r) => r.topic_label);

    const unclassified: UnclassifiedRow[] = await prisma.$queryRawUnsafe(
      `SELECT tag, COUNT(*)::int AS usage_count
       FROM posts p
       CROSS JOIN LATERAL unnest(p.hashtags) AS tag
       LEFT JOIN hashtag_topics ht ON ht.hashtag = tag
       WHERE ht.hashtag IS NULL AND tag IS NOT NULL AND tag != ''
       GROUP BY tag
       ORDER BY usage_count DESC
       LIMIT $1;`,
      BATCH_SIZE
    );

    if (unclassified.length === 0) {
      break;
    }

    const tags = unclassified.map((r) => r.tag);
    console.log(`[HashtagTopics] Mengklasifikasi batch ${tags.length} hashtag...`);

    try {
      const classification = await classifyHashtagBatch(tags, existingLabels);

      await prisma.$transaction(
        Object.entries(classification).map(([hashtag, topicLabel]) =>
          prisma.hashtagTopic.upsert({
            where: { hashtag },
            create: { hashtag, topicLabel },
            update: { topicLabel },
          })
        )
      );

      totalClassified += tags.length;
      console.log(
        `[HashtagTopics] Batch selesai: ${tags.length} hashtag terklasifikasi (total sesi ini: ${totalClassified}).`
      );
    } catch (err) {
      console.error(
        "[HashtagTopics] Gagal mengklasifikasi batch, akan dicoba lagi di siklus berikutnya:",
        err
      );
      break;
    }
  }

  if (totalClassified > 0) {
    await refreshTopicDistributionView();
  }
}
