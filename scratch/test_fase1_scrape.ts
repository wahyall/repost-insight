import fs from "fs";
import { prisma } from "../packages/db";
import {
  extractHashtags,
  saveScrapedReposts,
  reconcileInProgressFollowers,
} from "../apps/worker/src/scrapeLoop";
import { RepostApifyService, ApifyActorItem } from "../apps/worker/src/apifyClient";

async function testFase1() {
  console.log("=== MEMULAI TEST FASE 1: SCRAPING ENGINE & REKONSILIASI ===");

  // 1. Test: Hashtag Extraction
  console.log("\n[Test 1] Ekstraksi Hashtag dari caption...");
  const sampleCaption = "Kajian yuk #ngaji #Surabaya_Hebat dan #Indonesia!";
  const tags = extractHashtags(sampleCaption);
  console.log("Extracted tags:", tags);
  if (!tags.includes("ngaji") || !tags.includes("surabaya_hebat") || !tags.includes("indonesia")) {
    throw new Error("Hashtag extraction test failed");
  }
  console.log("[Test 1 PASS] Hashtag extraction sukses.");

  // 2. Test: Scrape Control (Pause / Resume)
  console.log("\n[Test 2] Uji Pause & Resume di database...");
  await prisma.scrapeControl.upsert({
    where: { id: 1 },
    create: { id: 1, isPaused: true, pauseReason: "Test Jeda" },
    update: { isPaused: true, pauseReason: "Test Jeda" },
  });

  let ctrl = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
  if (!ctrl?.isPaused || ctrl.pauseReason !== "Test Jeda") {
    throw new Error("Gagal pause scrape_control");
  }
  console.log("[Test 2 PASS] Pause aktif dengan reason:", ctrl.pauseReason);

  await prisma.scrapeControl.update({
    where: { id: 1 },
    data: { isPaused: false, pauseReason: null },
  });
  ctrl = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
  if (ctrl?.isPaused) {
    throw new Error("Gagal resume scrape_control");
  }
  console.log("[Test 2 PASS] Resume berhasil diaktifkan kembali.");

  // 3. Test: Penyimpanan Data Repost Asli (FR-4.1 - FR-4.4)
  console.log("\n[Test 3] Uji penyimpanan hasil scraping dengan sample repost asli...");
  const sampleRepostsFile = "D:\\yukngaji\\ynsurabaya_followers_reposts.json";
  const rawRepostData = JSON.parse(fs.readFileSync(sampleRepostsFile, "utf-8")) as ApifyActorItem[];
  console.log(`Membaca ${rawRepostData.length} item dari file sample repost...`);

  // Pastikan follower 'mtikaru' ada di tabel followers (karena foreign key)
  await prisma.follower.upsert({
    where: { username: "mtikaru" },
    create: { username: "mtikaru", status: "in_progress" },
    update: { status: "in_progress" },
  });

  // Simpan batch posts
  await saveScrapedReposts("mtikaru", rawRepostData);

  // Verifikasi tabel posts
  const postCount = await prisma.post.count();
  const repostCount = await prisma.repostEvent.count({ where: { followerUsername: "mtikaru" } });
  console.log(`[Test 3 PASS] Tersimpan ${postCount} posts dan ${repostCount} repost_events untuk @mtikaru.`);
  if (repostCount === 0) throw new Error("Repost events gagal tersimpan");

  // Uji idempotensi (re-scrape tidak duplikat)
  await saveScrapedReposts("mtikaru", rawRepostData);
  const repostCountAfter = await prisma.repostEvent.count({ where: { followerUsername: "mtikaru" } });
  if (repostCountAfter !== repostCount) {
    throw new Error("Idempotensi gagal: Re-scrape menghasilkan duplikasi repost_events!");
  }
  console.log("[Test 3 PASS] Idempotensi terverifikasi: re-scrape tidak menghasilkan duplikat!");

  // 4. Test: Startup Reconciliation (FR-2.3)
  console.log("\n[Test 4] Uji Startup Reconciliation (proses mati mendadak saat in_progress)...");

  // Buat 2 follower in_progress simulasi
  await prisma.follower.upsert({
    where: { username: "follower_reconcile_succeed" },
    create: {
      username: "follower_reconcile_succeed",
      status: "in_progress",
      apifyRunId: "mock_run_succeed",
      retryCount: 0,
    },
    update: {
      status: "in_progress",
      apifyRunId: "mock_run_succeed",
      retryCount: 0,
    },
  });

  await prisma.follower.upsert({
    where: { username: "follower_reconcile_fail" },
    create: {
      username: "follower_reconcile_fail",
      status: "in_progress",
      apifyRunId: "mock_run_fail",
      retryCount: 0,
    },
    update: {
      status: "in_progress",
      apifyRunId: "mock_run_fail",
      retryCount: 0,
    },
  });

  // Mock service getter
  const mockService = {
    getRunStatus: async (runId: string) => {
      if (runId === "mock_run_succeed") {
        return {
          runId,
          status: "SUCCEEDED",
          datasetId: "mock_dataset_1",
        };
      } else {
        return {
          runId,
          status: "FAILED",
        };
      }
    },
    getDatasetItems: async (datasetId: string) => {
      return [
        {
          id: "mock_post_reconcile_1",
          caption: "Kajian inspiratif #reconcile",
          like_count: 50,
        },
      ];
    },
  } as unknown as RepostApifyService;

  await reconcileInProgressFollowers(async () => mockService);

  // Verifikasi hasil rekonsiliasi
  const fSucceed = await prisma.follower.findUnique({
    where: { username: "follower_reconcile_succeed" },
  });
  const fFail = await prisma.follower.findUnique({
    where: { username: "follower_reconcile_fail" },
  });

  if (fSucceed?.status !== "done" || !fSucceed.lastScrapedAt) {
    throw new Error(`Reconciliation succeed failed: ${JSON.stringify(fSucceed)}`);
  }
  console.log(`[Test 4 PASS] follower_reconcile_succeed berhasil direkonsiliasi menjadi 'done'.`);

  if (fFail?.status !== "pending" || fFail.retryCount !== 1) {
    throw new Error(`Reconciliation retry failed: ${JSON.stringify(fFail)}`);
  }
  console.log(`[Test 4 PASS] follower_reconcile_fail berhasil direkonsiliasi: status 'pending', retry_count: 1.`);

  // Bersihkan data mock
  await prisma.repostEvent.deleteMany({
    where: { followerUsername: { in: ["follower_reconcile_succeed", "follower_reconcile_fail"] } },
  });
  await prisma.follower.deleteMany({
    where: { username: { in: ["follower_reconcile_succeed", "follower_reconcile_fail"] } },
  });
  await prisma.post.deleteMany({
    where: { id: "mock_post_reconcile_1" },
  });

  console.log("\n=== SELURUH UJI FASE 1 SUKSES 100% ===");
}

testFase1()
  .catch((err) => {
    console.error("Test Fase 1 Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
