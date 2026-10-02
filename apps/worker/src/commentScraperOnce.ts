import path from "path";
import dotenv from "dotenv";

// Load worker .env first, then root .env with override so root .env takes precedence
dotenv.config();
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnvPath, override: true });

import { prisma } from "@repostinsight/db";
import {
  scrapeCommentsForPost,
  processPendingCommentsBatch,
  startCommentScrapeLoop,
} from "./commentLoop";

const shouldStopRef = { stop: false };

const shutdown = () => {
  console.log("\n[CommentScraper] Menerima sinyal berhenti, menyelesaikan proses yang sedang berjalan...");
  shouldStopRef.stop = true;
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  const args = process.argv.slice(2);
  const postArg = args.find((a) => a.startsWith("--post=") || a.startsWith("post="));
  const postIdx = Math.max(args.indexOf("--post"), args.indexOf("-p"));
  const specificPostId = postArg
    ? postArg.split("=")[1]
    : postIdx !== -1 && args[postIdx + 1]
    ? args[postIdx + 1]
    : null;

  const isLoop = args.includes("--loop") || args.includes("--watch");

  let maxLimit: number | null = null;
  const limitArg = args.find((a) => a.startsWith("--limit=") || a.startsWith("limit="));
  if (limitArg) {
    maxLimit = parseInt(limitArg.split("=")[1], 10);
  } else if (args.includes("--limit") || args.includes("-n")) {
    const idx = Math.max(args.indexOf("--limit"), args.indexOf("-n"));
    if (idx !== -1 && args[idx + 1]) maxLimit = parseInt(args[idx + 1], 10);
  } else {
    const numArg = args.find((a) => /^\d+$/.test(a));
    if (numArg !== undefined) {
      maxLimit = parseInt(numArg, 10);
    }
  }

  console.log("==========================================");
  console.log("  RepostInsight Comment Scraper (F11)     ");
  console.log("==========================================");

  // Jika spesifik satu post
  if (specificPostId) {
    console.log(`[CommentScraper] Memproses satu post spesifik: ${specificPostId}`);
    const res = await scrapeCommentsForPost(specificPostId);
    console.log("[CommentScraper] Hasil:", res);
    process.exit(res.success ? 0 : 1);
  }

  // Cek jumlah pending
  const initialPending = await prisma.post.count({
    where: { commentsStatus: "pending" },
  });
  const totalComments = await prisma.comment.count();
  const doneCount = await prisma.post.count({ where: { commentsStatus: "done" } });
  const skippedCount = await prisma.post.count({ where: { commentsStatus: "skipped" } });
  const failedCount = await prisma.post.count({ where: { commentsStatus: "failed" } });

  console.log(`[CommentScraper] Status database saat ini:`);
  console.log(`  - Post Pending Komentar : ${initialPending}`);
  console.log(`  - Post Selesai Komentar : ${doneCount}`);
  console.log(`  - Post Di-skip (0 komen): ${skippedCount}`);
  console.log(`  - Post Gagal Komentar   : ${failedCount}`);
  console.log(`  - Total Komentar Tersimpan : ${totalComments}`);

  if (maxLimit === 0) {
    console.log("[CommentScraper] Limit disetel 0 (dry-run). Ringkasan status ditampilkan di atas. Selesai.");
    process.exit(0);
  }

  if (initialPending === 0 && !isLoop) {
    console.log("[CommentScraper] Tidak ada postingan dengan status commentsStatus = 'pending'. Selesai.");
    process.exit(0);
  }

  if (isLoop) {
    console.log("[CommentScraper] Mode loop aktif — akan terus memantau postingan pending.");
    await startCommentScrapeLoop(shouldStopRef);
    process.exit(0);
  }

  // Mode batch hingga selesai atau sampai batas limit
  const targetCount = maxLimit ? Math.min(maxLimit, initialPending) : initialPending;
  console.log(`[CommentScraper] Memulai proses scraping komentar untuk ${targetCount} post pending...`);

  let totalProcessed = 0;
  let totalDone = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  while (!shouldStopRef.stop && totalProcessed < targetCount) {
    const batchSize = Math.min(5, targetCount - totalProcessed);
    const stats = await processPendingCommentsBatch(batchSize, shouldStopRef);
    if (stats.processed === 0) break;

    totalProcessed += stats.processed;
    totalDone += stats.done;
    totalSkipped += stats.skipped;
    totalFailed += stats.failed;

    console.log(
      `[CommentScraper] Progres: ${totalProcessed}/${targetCount} (Done: ${totalDone}, Skipped: ${totalSkipped}, Failed: ${totalFailed})`
    );
  }

  console.log("==========================================");
  console.log(`[CommentScraper] Selesai memproses ${totalProcessed} post.`);
  console.log(`  - Berhasil (done)   : ${totalDone}`);
  console.log(`  - Di-skip (skipped) : ${totalSkipped}`);
  console.log(`  - Gagal (failed)    : ${totalFailed}`);
  console.log("==========================================");

  process.exit(0);
}

main().catch((err) => {
  console.error("[CommentScraper] Fatal error:", err);
  process.exit(1);
});
