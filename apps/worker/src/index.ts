import path from "path";
import dotenv from "dotenv";

// Load worker .env first, then root .env with override so root .env takes precedence
dotenv.config();
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnvPath, override: true });
import { prisma } from "@repostinsight/db";
import { RepostApifyService } from "./apifyClient";
import { startScrapeLoop } from "./scrapeLoop";

import { OpenRouterEmbeddingService } from "./openrouterClient";
import { startEmbeddingLoop } from "./embeddingLoop";

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

  const embeddingService = new OpenRouterEmbeddingService();

  // Run both scraping loop and embedding pipeline concurrently
  await Promise.all([
    startScrapeLoop(getActiveApifyService, shouldStopRef),
    startEmbeddingLoop(embeddingService, shouldStopRef),
  ]);
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
