import path from "path";
import dotenv from "dotenv";

// Load worker .env first, then root .env with override so root .env takes precedence
dotenv.config();
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnvPath, override: true });
import { prisma } from "@repostinsight/db";
import { RepostApifyService } from "./apifyClient";
import { startScrapeLoop } from "./scrapeLoop";

import { OllamaEmbeddingService } from "./ollamaClient";
import { startEmbeddingLoop } from "./embeddingLoop";
import { reclassifyHashtagTopics } from "./hashtagTopics";

const shouldStopRef = { stop: false };

/**
 * Helper to obtain an active Apify client instance.
 * Checks the database apify_api_keys table first (status = 'active'),
 * then falls back to APIFY_API_KEY env var if set.
 */
export async function getActiveApifyService(): Promise<RepostApifyService | null> {
  const activeKey = await prisma.apifyApiKey.findFirst({
    where: { status: "active" },
    orderBy: { lastUsedAt: "asc" }, // Prioritize least-recently used key
  });

  if (activeKey?.token) {
    return new RepostApifyService(activeKey.token);
  }

  // Fallback to env var if present
  if (process.env.APIFY_API_KEY) {
    return new RepostApifyService(process.env.APIFY_API_KEY);
  }

  return null;
}

const HASHTAG_RECLASSIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 jam

/**
 * Menuntaskan backlog klasifikasi topik hashtag saat startup, lalu mengulang tiap 24 jam
 * untuk menangkap hashtag baru dari scraping berikutnya (PROMPT-UPGRADE-CHATBOT.md item 7).
 */
async function startHashtagTopicLoop(shouldStopRef: { stop: boolean }) {
  console.log("[Worker] Memulai loop klasifikasi topik hashtag...");
  while (!shouldStopRef.stop) {
    try {
      await reclassifyHashtagTopics();
    } catch (err) {
      console.error("[Worker] Gagal menjalankan reclassifyHashtagTopics:", err);
    }

    const checkIntervalMs = 60_000;
    let waited = 0;
    while (waited < HASHTAG_RECLASSIFY_INTERVAL_MS && !shouldStopRef.stop) {
      await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
      waited += checkIntervalMs;
    }
  }
}

async function main() {
  console.log("==========================================");
  console.log("  RepostInsight Background Worker Engine  ");
  console.log("==========================================");

  // Handle graceful termination
  const shutdown = async () => {
    console.log("\n[Worker] Menerima sinyal shutdown, menghentikan loop dengan aman...");
    shouldStopRef.stop = true;
    setTimeout(() => {
      console.log("[Worker] Seluruh loop dihentikan.");
      process.exit(0);
    }, 1000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const embeddingService = new OllamaEmbeddingService();

  // Run scraping loop, embedding pipeline, and hashtag topic classification concurrently
  await Promise.all([
    startScrapeLoop(getActiveApifyService, shouldStopRef),
    startEmbeddingLoop(embeddingService, shouldStopRef),
    startHashtagTopicLoop(shouldStopRef),
  ]);
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
