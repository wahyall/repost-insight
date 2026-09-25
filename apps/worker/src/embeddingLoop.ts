import { prisma } from "@repostinsight/db";
import { OllamaEmbeddingService } from "./ollamaClient";

const BATCH_SIZE = 15; // 10–20 per siklus sesuai FR-5.2 & SRS §8
const DEFAULT_LOOP_INTERVAL_MS = 6000;
const MAX_BACKOFF_MS = 60000;

/**
 * Menghapus seluruh emoji, modifier, piktografik, dan flag dari teks
 */
export function removeEmojis(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u{1F1E6}-\u{1F1FF}]/gu, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

/**
 * Siapkan teks embedding sesuai FR-5.3:
 * Urutan: hashtags → visual_description → caption_text
 * Batas defensif 8.000 karakter (model nvidia punya 131K token, jauh lebih dari cukup untuk konten normal).
 * Jika batas tersentuh, caption dipotong lebih dulu.
 */
export function prepareEmbeddingText(
  captionText: string | null,
  hashtags: string[] = [],
  visualDescription?: string | null
): string {
  // 1. Hashtags
  const formattedTags = hashtags
    .map((h) => removeEmojis(h).replace(/^#/, "").trim().toLowerCase())
    .filter((h) => h.length > 0)
    .map((h) => `#${h}`)
    .join(" ");

  // 2. Visual description (sudah teks bersih dari vision model, tidak perlu strip emoji)
  const cleanVisual = visualDescription?.trim() ?? "";

  // 3. Caption
  const cleanCaption = captionText ? removeEmojis(captionText) : "";

  // Susun bagian yang tidak kosong
  const parts: string[] = [
    formattedTags,
    cleanVisual,
    cleanCaption,
  ].filter((p) => p.length > 0);

  const combined = parts.join("\n\n").trim();
  if (!combined) return "";

  // Batas defensif 8.000 karakter (FR-5.3): potong caption lebih dulu jika perlu
  const MAX_CHARS = 8000;
  if (combined.length <= MAX_CHARS) return combined;

  // Rekonstruksi dengan caption dipotong
  const baseWithoutCaption = [formattedTags, cleanVisual].filter((p) => p.length > 0).join("\n\n");
  const remaining = MAX_CHARS - baseWithoutCaption.length - 2; // 2 untuk "\n\n"
  if (remaining <= 0) {
    return baseWithoutCaption.slice(0, MAX_CHARS);
  }
  return (baseWithoutCaption + "\n\n" + cleanCaption.slice(0, remaining)).trim();
}

/**
 * Main embedding worker loop (FR-5.1–5.4)
 */
export async function startEmbeddingLoop(
  embeddingService: OllamaEmbeddingService,
  shouldStopRef: { stop: boolean }
) {
  console.log(`[EmbeddingLoop] Memulai loop embedding post (model: ${process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:0.6b"})...`);
  let currentBackoffMs = DEFAULT_LOOP_INTERVAL_MS;

  while (!shouldStopRef.stop) {
    try {
      // 1. Ambil batch post dengan embedding_status = 'pending'
      const pendingPosts = await prisma.post.findMany({
        where: { embeddingStatus: "pending" },
        take: BATCH_SIZE,
        orderBy: { firstSeenAt: "asc" },
      });

      if (pendingPosts.length === 0) {
        // Tidak ada post antrean, reset backoff dan tunggu
        currentBackoffMs = DEFAULT_LOOP_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, DEFAULT_LOOP_INTERVAL_MS));
        continue;
      }

      console.log(`[EmbeddingLoop] Memproses batch ${pendingPosts.length} post pending...`);

      // 2. Siapkan teks yang sudah di-truncate (FR-5.3)
      //    Kolom visual_description tidak ada di Prisma model karena ditambah via SQL manual,
      //    jadi ambil lewat $queryRaw
      const postIds = pendingPosts.map((p) => p.id);
      const visualRows: Array<{ id: string; visual_description: string | null }> =
        postIds.length > 0
          ? await prisma.$queryRawUnsafe(
              `SELECT id, visual_description FROM posts WHERE id = ANY($1::text[])`,
              postIds
            )
          : [];
      const visualMap = new Map(visualRows.map((r) => [r.id, r.visual_description ?? null]));

      const validItems: { id: string; text: string }[] = [];
      for (const p of pendingPosts) {
        const visualDesc = visualMap.get(p.id) ?? null;
        const text = prepareEmbeddingText(p.captionText, p.hashtags, visualDesc);
        if (text) {
          validItems.push({ id: p.id, text });
        } else {
          // Post tanpa teks (hanya media kosong), tandai done agar tidak loop selamanya
          await prisma.post.update({
            where: { id: p.id },
            data: { embeddingStatus: "done" },
          });
        }
      }

      if (validItems.length > 0) {
        let embeddings: { index: number; embedding: number[] }[] = [];
        try {
          const texts = validItems.map((v) => v.text);
          embeddings = await embeddingService.generateEmbeddings(texts);
        } catch (batchErr: any) {
          // Tangani secara anggun jika salah satu post melebihi batas token (HTTP 400)
          if (
            batchErr?.message?.includes("400") ||
            batchErr?.message?.includes("exceeding the model maximum")
          ) {
            console.warn(
              "[EmbeddingLoop] Terdeteksi post melebihi batas token dalam batch. Memproses per-item dengan pemotongan teks ekstra..."
            );
            embeddings = [];
            for (let i = 0; i < validItems.length; i++) {
              const item = validItems[i];
              try {
                // Potong lebih agresif ke 700 karakter
                const safeText = item.text.slice(0, 700);
                const singleRes = await embeddingService.generateEmbeddings([safeText]);
                if (singleRes && singleRes[0]) {
                  embeddings.push({ index: i, embedding: singleRes[0].embedding });
                }
              } catch (singleErr) {
                console.warn(
                  `[EmbeddingLoop] Post ${item.id} tidak dapat di-embed (ditandai 'done' agar antrean tidak macet).`
                );
                await prisma.post.update({
                  where: { id: item.id },
                  data: { embeddingStatus: "done" },
                });
              }
            }
          } else {
            throw batchErr;
          }
        }

        // 3. Simpan vector ke pgvector di Postgres (FR-5.2)
        for (const item of embeddings) {
          const target = validItems[item.index];
          if (!target) continue;

          const vectorStr = `[${item.embedding.join(",")}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE posts SET embedding = $1::vector, embedding_status = 'done', last_updated_at = NOW() WHERE id = $2`,
            vectorStr,
            target.id
          );
        }

        console.log(`[EmbeddingLoop] Berhasil membuat embedding untuk ${embeddings.length} post.`);
      }

      // Berhasil, reset interval ke normal
      currentBackoffMs = DEFAULT_LOOP_INTERVAL_MS;
    } catch (err: unknown) {
      currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS);
      const isPrismaError = (err as any)?.name?.includes("Prisma") || (err as any)?.code?.startsWith("P");
      if (isPrismaError) {
        console.error(`[EmbeddingLoop] Kesalahan koneksi / query database:`, err);
      } else {
        console.error(`[EmbeddingLoop] Kesalahan Ollama embedding API:`, err);
      }
      console.warn(`[EmbeddingLoop] Menunggu ${currentBackoffMs / 1000}s sebelum retry berikutnya...`);
    }

    await new Promise((resolve) => setTimeout(resolve, currentBackoffMs));
  }

  console.log("[EmbeddingLoop] Loop embedding telah dihentikan.");
}
