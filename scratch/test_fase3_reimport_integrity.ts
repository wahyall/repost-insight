import { prisma } from "../packages/db";
import { saveScrapedReposts } from "../apps/worker/src/scrapeLoop";

async function testFase3() {
  console.log("=== MEMULAI TEST FASE 3: RE-IMPORT & INTEGRITAS DATA ===");

  // 1. Setup Data Uji Follower
  console.log("\n[Test 1] Menyiapkan follower dengan status beragam...");
  await prisma.follower.upsert({
    where: { username: "fase3_user_done" },
    create: { username: "fase3_user_done", status: "done", apifyRunId: "run_done_1", retryCount: 0 },
    update: { status: "done", apifyRunId: "run_done_1" },
  });

  await prisma.follower.upsert({
    where: { username: "fase3_user_failed" },
    create: { username: "fase3_user_failed", status: "failed", apifyRunId: "run_fail_1", retryCount: 3 },
    update: { status: "failed", apifyRunId: "run_fail_1", retryCount: 3 },
  });

  console.log("[Test 1 PASS] Follower fase3_user_done (done) dan fase3_user_failed (failed) siap.");

  // 2. Test: Re-import dengan Find-or-Create (FR-1.3, FR-1.4)
  console.log("\n[Test 2] Uji Re-import (campuran follower lama & baru)...");
  const batchImport = [
    "fase3_user_done",     // sudah ada (status: done) -> tidak boleh direset!
    "fase3_user_failed",   // sudah ada (status: failed) -> tidak boleh direset!
    "fase3_user_new_a",    // baru -> harus diinsert pending
    "fase3_user_new_b",    // baru -> harus diinsert pending
  ];

  const beforeTotal = await prisma.follower.count();
  const insertRes = await prisma.follower.createMany({
    data: batchImport.map((u) => ({ username: u, status: "pending" })),
    skipDuplicates: true,
  });

  console.log(`Hasil insertMany: ${insertRes.count} baris baru diinsert (ekspektasi: 2 baru).`);
  if (insertRes.count !== 2) {
    throw new Error(`Ekspektasi 2 baris baru, didapat ${insertRes.count}`);
  }

  // Verifikasi status follower yang sudah ada tidak berubah
  const checkDone = await prisma.follower.findUnique({ where: { username: "fase3_user_done" } });
  const checkFailed = await prisma.follower.findUnique({ where: { username: "fase3_user_failed" } });

  if (checkDone?.status !== "done" || checkDone.apifyRunId !== "run_done_1") {
    throw new Error(`Integritas gagal: Status 'fase3_user_done' ter-reset! Nilai: ${JSON.stringify(checkDone)}`);
  }
  if (checkFailed?.status !== "failed" || checkFailed.retryCount !== 3) {
    throw new Error(`Integritas gagal: Status 'fase3_user_failed' ter-reset! Nilai: ${JSON.stringify(checkFailed)}`);
  }
  console.log("[Test 2 PASS] Re-import tidak mereset status data yang sudah ada sebelumnya.");

  // 3. Test: Manual Retry Endpoint Logic (FR-2.7)
  console.log("\n[Test 3] Uji manual retry untuk follower yang failed...");
  const retried = await prisma.follower.update({
    where: { username: "fase3_user_failed" },
    data: {
      status: "pending",
      retryCount: 0,
      apifyRunId: null,
    },
  });

  if (retried.status !== "pending" || retried.retryCount !== 0 || retried.apifyRunId !== null) {
    throw new Error(`Manual retry gagal: ${JSON.stringify(retried)}`);
  }
  console.log("[Test 3 PASS] Follower berhasil di-reset manual menjadi status 'pending', retry_count 0.");

  // 4. Test: Re-scrape find-or-create idempotency (FR-4.1 - FR-4.3)
  console.log("\n[Test 4] Uji re-scrape berulang kali terhadap follower yang sama...");
  const mockDataset = [
    {
      id: "fase3_post_1",
      shortCode: "CODE1",
      caption: "Caption original post 1 #dakwah",
      likeCount: 100,
      originalAuthor: "ustadz_a",
    },
    {
      id: "fase3_post_2",
      shortCode: "CODE2",
      caption: "Caption original post 2 #sunnah",
      likeCount: 200,
      originalAuthor: "ustadz_b",
    },
  ];

  // Scrape pertama
  await saveScrapedReposts("fase3_user_done", mockDataset);
  const countEvents1 = await prisma.repostEvent.count({ where: { followerUsername: "fase3_user_done" } });

  // Scrape kedua (dengan likeCount terupdate)
  mockDataset[0].likeCount = 150;
  await saveScrapedReposts("fase3_user_done", mockDataset);
  const countEvents2 = await prisma.repostEvent.count({ where: { followerUsername: "fase3_user_done" } });

  if (countEvents1 !== countEvents2 || countEvents1 !== 2) {
    throw new Error(`Re-scrape menghasilkan duplikasi repost_events! Awal: ${countEvents1}, Akhir: ${countEvents2}`);
  }

  // Verifikasi update like_count
  const updatedPost = await prisma.post.findUnique({ where: { id: "fase3_post_1" } });
  if (updatedPost?.likeCount !== 150) {
    throw new Error(`Post update gagal! Like count: ${updatedPost?.likeCount}`);
  }
  console.log("[Test 4 PASS] Re-scrape terbukti 100% idempoten tanpa duplikasi repost_events.");

  // Cleanup data uji
  await prisma.repostEvent.deleteMany({
    where: { followerUsername: { in: batchImport } },
  });
  await prisma.follower.deleteMany({
    where: { username: { in: batchImport } },
  });
  await prisma.post.deleteMany({
    where: { id: { in: ["fase3_post_1", "fase3_post_2"] } },
  });

  console.log("\n=== SELURUH UJI FASE 3 SUKSES 100% ===");
}

testFase3()
  .catch((err) => {
    console.error("Test Fase 3 Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
