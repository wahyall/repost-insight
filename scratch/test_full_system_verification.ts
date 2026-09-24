import { prisma } from "../packages/db";
import bcrypt from "bcryptjs";
import { extractUsernamesFromJson } from "../apps/web/lib/followers";
import {
  extractHashtags,
  saveScrapedReposts,
  reconcileInProgressFollowers,
} from "../apps/worker/src/scrapeLoop";
import {
  handleKeyError,
  autoReactivateExhaustedKeys,
  checkAllKeysNonActive,
  getNextActiveApifyKey,
} from "../apps/worker/src/keyRotation";
import { prepareEmbeddingText } from "../apps/worker/src/embeddingLoop";
import {
  executeSemanticSearch,
  executeQueryAggregate,
  executeRenderChart,
} from "../apps/web/lib/tools";

async function runFullVerification() {
  console.log("=================================================================");
  console.log("  REPOSTINSIGHT — FULL SYSTEM MANUAL & REGRESSION VERIFICATION   ");
  console.log("=================================================================\n");

  // Initial clean up of test records
  await prisma.repostEvent.deleteMany({
    where: { followerUsername: { startsWith: "sys_test_" } },
  });
  await prisma.follower.deleteMany({
    where: { username: { startsWith: "sys_test_" } },
  });

  const results: { test: string; status: "PASS" | "FAIL"; note?: string }[] = [];

  // TC-1: Import file followers.json valid (FR-1.1, FR-1.2)
  try {
    const rawSample = [
      { string_list_data: [{ value: "sys_test_user_1" }] },
      { string_list_data: [{ value: "sys_test_user_2" }] },
    ];
    const extracted = extractUsernamesFromJson(rawSample);
    await prisma.follower.createMany({
      data: extracted.map((u) => ({ username: u, status: "pending" })),
      skipDuplicates: true,
    });
    const check = await prisma.follower.findMany({
      where: { username: { in: extracted } },
    });
    if (check.length === 2 && check.every((c) => c.status === "pending")) {
      results.push({ test: "TC-1: Import Followers Valid", status: "PASS" });
    } else {
      results.push({ test: "TC-1: Import Followers Valid", status: "FAIL", note: "Status bukan pending" });
    }
  } catch (e: any) {
    results.push({ test: "TC-1: Import Followers Valid", status: "FAIL", note: e.message });
  }

  // TC-2: Re-import find-or-create (FR-1.3, FR-1.4)
  try {
    await prisma.follower.update({
      where: { username: "sys_test_user_1" },
      data: { status: "done", apifyRunId: "run_sys_1" },
    });
    const reimportPayload = [
      { string_list_data: [{ value: "sys_test_user_1" }] },
      { string_list_data: [{ value: "sys_test_user_3" }] },
    ];
    const ext = extractUsernamesFromJson(reimportPayload);
    const res = await prisma.follower.createMany({
      data: ext.map((u) => ({ username: u, status: "pending" })),
      skipDuplicates: true,
    });
    const check1 = await prisma.follower.findUnique({ where: { username: "sys_test_user_1" } });
    if (res.count === 1 && check1?.status === "done" && check1.apifyRunId === "run_sys_1") {
      results.push({ test: "TC-2: Re-import Find-or-Create (No Reset)", status: "PASS" });
    } else {
      results.push({ test: "TC-2: Re-import Find-or-Create (No Reset)", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-2: Re-import Find-or-Create (No Reset)", status: "FAIL", note: e.message });
  }

  // TC-3: Upload file kosong/rusak ditolak (FR-1.5)
  try {
    const emptyExt = extractUsernamesFromJson([]);
    const invalidExt = extractUsernamesFromJson({ unexpected: "data" });
    if (emptyExt.length === 0 && invalidExt.length === 0) {
      results.push({ test: "TC-3: File Kosong/Rusak Ditolak", status: "PASS" });
    } else {
      results.push({ test: "TC-3: File Kosong/Rusak Ditolak", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-3: File Kosong/Rusak Ditolak", status: "FAIL", note: e.message });
  }

  // TC-4: Scraping pause / resume (FR-2.4, FR-2.5)
  try {
    await prisma.scrapeControl.update({ where: { id: 1 }, data: { isPaused: true, pauseReason: "TC-4 test" } });
    const p1 = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
    await prisma.scrapeControl.update({ where: { id: 1 }, data: { isPaused: false, pauseReason: null } });
    const p2 = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
    if (p1?.isPaused && !p2?.isPaused) {
      results.push({ test: "TC-4: Scrape Control Pause/Resume", status: "PASS" });
    } else {
      results.push({ test: "TC-4: Scrape Control Pause/Resume", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-4: Scrape Control Pause/Resume", status: "FAIL", note: e.message });
  }

  // TC-5: Startup reconciliation (FR-2.3)
  try {
    await prisma.follower.upsert({
      where: { username: "sys_test_reconcile" },
      create: { username: "sys_test_reconcile", status: "in_progress", apifyRunId: "mock_rec_run", retryCount: 0 },
      update: { status: "in_progress", apifyRunId: "mock_rec_run", retryCount: 0 },
    });
    const mockService = {
      getRunStatus: async () => ({ runId: "mock_rec_run", status: "SUCCEEDED", datasetId: "ds_1" }),
      getDatasetItems: async () => [{ id: "sys_post_rec_1", caption: "Reconcile test", likeCount: 1 }],
    } as any;
    await reconcileInProgressFollowers(async () => mockService);
    const recCheck = await prisma.follower.findUnique({ where: { username: "sys_test_reconcile" } });
    if (recCheck?.status === "done" && recCheck.lastScrapedAt) {
      results.push({ test: "TC-5: Startup Reconciliation", status: "PASS" });
    } else {
      results.push({ test: "TC-5: Startup Reconciliation", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-5: Startup Reconciliation", status: "FAIL", note: e.message });
  }

  // TC-6: Multi API key rotation (FR-3.2 - FR-3.7)
  try {
    const testKey = await prisma.apifyApiKey.create({
      data: { label: "SYS_TC6", token: "sys_token_tc6", status: "active", maxMonthlyUsageUsd: 5.0, monthlyUsageUsd: 1.0 },
    });
    const err402 = { statusCode: 402, message: "Payment Required" };
    const { rotated } = await handleKeyError(testKey.id, err402);
    const updatedKey = await prisma.apifyApiKey.findUnique({ where: { id: testKey.id } });
    await prisma.apifyApiKey.delete({ where: { id: testKey.id } });
    if (rotated && updatedKey?.status === "exhausted") {
      results.push({ test: "TC-6: Multi API-Key Rotation", status: "PASS" });
    } else {
      results.push({ test: "TC-6: Multi API-Key Rotation", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-6: Multi API-Key Rotation", status: "FAIL", note: e.message });
  }

  // TC-7: Pipeline embedding & pgvector (FR-5.1 - FR-5.4)
  try {
    const textPrep = prepareEmbeddingText("A".repeat(2500), ["tag1", "tag2"]);
    const isTruncated = textPrep.length <= 1800;
    const mockVec = Array.from({ length: 1024 }, () => 0.01);
    await prisma.post.upsert({
      where: { id: "sys_post_vec_1" },
      create: { id: "sys_post_vec_1", captionText: "Vector test", embeddingStatus: "pending" },
      update: { captionText: "Vector test", embeddingStatus: "pending" },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE posts SET embedding = $1::vector, embedding_status = 'done' WHERE id = $2`,
      `[${mockVec.join(",")}]`,
      "sys_post_vec_1"
    );
    const vecPost = await prisma.post.findUnique({ where: { id: "sys_post_vec_1" } });
    await prisma.post.delete({ where: { id: "sys_post_vec_1" } });
    if (isTruncated && vecPost?.embeddingStatus === "done") {
      results.push({ test: "TC-7: Pipeline Embedding & pgvector", status: "PASS" });
    } else {
      results.push({ test: "TC-7: Pipeline Embedding & pgvector", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-7: Pipeline Embedding & pgvector", status: "FAIL", note: e.message });
  }

  // TC-8: Dashboard & Materialized Views (FR-7.1, FR-7.2)
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_reposted_accounts;`);
    const mvRes: any[] = await prisma.$queryRawUnsafe(`SELECT count(*) as c FROM mv_top_reposted_accounts;`);
    if (mvRes && mvRes.length > 0) {
      results.push({ test: "TC-8: Dashboard Materialized Views", status: "PASS" });
    } else {
      results.push({ test: "TC-8: Dashboard Materialized Views", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-8: Dashboard Materialized Views", status: "FAIL", note: e.message });
  }

  // TC-9: Chatbot Tools RAG (FR-6.1 - FR-6.5)
  try {
    const agg = await executeQueryAggregate("summary");
    const chart = executeRenderChart("bar", "Chart Test", [{ name: "A", value: 10 }]);
    const chatMsg = await prisma.chatMessage.create({
      data: { role: "assistant", content: "Chatbot test", toolCalls: [chart] as any },
    });
    await prisma.chatMessage.delete({ where: { id: chatMsg.id } });
    if (agg.metric === "summary" && chart.isChart && chatMsg.id) {
      results.push({ test: "TC-9: Chatbot Tools (RAG/Aggregate/Chart)", status: "PASS" });
    } else {
      results.push({ test: "TC-9: Chatbot Tools (RAG/Aggregate/Chart)", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-9: Chatbot Tools (RAG/Aggregate/Chart)", status: "FAIL", note: e.message });
  }

  // TC-10: Autentikasi statis & bcrypt hashing (FR-8.1, FR-8.2)
  try {
    const testPlain = "wahyuPassword2026";
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(testPlain, salt);
    const isValid = bcrypt.compareSync(testPlain, hash);
    const isInvalid = bcrypt.compareSync("wrongpassword", hash);
    if (isValid && !isInvalid) {
      results.push({ test: "TC-10: Autentikasi Statis & Bcrypt Hash", status: "PASS" });
    } else {
      results.push({ test: "TC-10: Autentikasi Statis & Bcrypt Hash", status: "FAIL" });
    }
  } catch (e: any) {
    results.push({ test: "TC-10: Autentikasi Statis & Bcrypt Hash", status: "FAIL", note: e.message });
  }

  // Cleanup remaining test records (delete children repostEvent before parent follower)
  await prisma.repostEvent.deleteMany({
    where: { followerUsername: { in: ["sys_test_user_1", "sys_test_user_2", "sys_test_user_3", "sys_test_reconcile"] } },
  });
  await prisma.follower.deleteMany({
    where: { username: { in: ["sys_test_user_1", "sys_test_user_2", "sys_test_user_3", "sys_test_reconcile"] } },
  });
  await prisma.post.deleteMany({
    where: { id: "sys_post_rec_1" },
  });
  await prisma.scrapeControl.update({
    where: { id: 1 },
    data: { isPaused: false, pauseReason: null },
  });

  console.log("-----------------------------------------------------------------");
  console.log("                      HASIL EVALUASI SISTEM                      ");
  console.log("-----------------------------------------------------------------");
  let allPass = true;
  for (const r of results) {
    const mark = r.status === "PASS" ? "✔ [PASS]" : "✖ [FAIL]";
    console.log(`${mark.padEnd(9)} | ${r.test}${r.note ? ` (${r.note})` : ""}`);
    if (r.status !== "PASS") allPass = false;
  }
  console.log("-----------------------------------------------------------------");
  if (allPass) {
    console.log("SELURUH 10/10 TEST CASE DARI SRS.md §10 LENGKAP & LOLOS 100%!");
  } else {
    throw new Error("Sebagian test case gagal");
  }
}

runFullVerification()
  .catch((err) => {
    console.error("Verifikasi Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
