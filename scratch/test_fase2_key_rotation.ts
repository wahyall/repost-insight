import { prisma } from "../packages/db";
import {
  handleKeyError,
  autoReactivateExhaustedKeys,
  checkAllKeysNonActive,
  getNextActiveApifyKey,
} from "../apps/worker/src/keyRotation";

async function testFase2() {
  console.log("=== MEMULAI TEST FASE 2: MULTI API-KEY ROTATION ===");

  // Cleanup existing test keys
  await prisma.apifyApiKey.deleteMany({
    where: { label: { startsWith: "TEST_" } },
  });

  // 1. Test: Buat 2 test key
  console.log("\n[Test 1] Menyiapkan 2 API Key di database (Key A & Key B)...");
  const keyA = await prisma.apifyApiKey.create({
    data: {
      label: "TEST_KEY_A",
      token: "apify_api_test_token_aaaa",
      status: "active",
      monthlyUsageUsd: 1.0,
      maxMonthlyUsageUsd: 5.0,
      usageCycleEndsAt: new Date(Date.now() + 86400000 * 10), // 10 hari lagi
    },
  });

  const keyB = await prisma.apifyApiKey.create({
    data: {
      label: "TEST_KEY_B",
      token: "apify_api_test_token_bbbb",
      status: "active",
      monthlyUsageUsd: 0.5,
      maxMonthlyUsageUsd: 5.0,
      usageCycleEndsAt: new Date(Date.now() + 86400000 * 10),
    },
  });

  console.log(`[Test 1 PASS] Key A (#${keyA.id}) dan Key B (#${keyB.id}) tersimpan dengan status 'active'.`);

  // 2. Test: Pemilihan Key Pertama
  console.log("\n[Test 2] Memilih active key pertama...");
  const firstPick = await getNextActiveApifyKey();
  if (!firstPick || (firstPick.keyId !== keyA.id && firstPick.keyId !== keyB.id)) {
    throw new Error(`Gagal memilih key aktif: ${JSON.stringify(firstPick)}`);
  }
  console.log(`[Test 2 PASS] Dipilih Key #${firstPick.keyId}`);

  // 3. Test: Reactive HTTP 402 Payment Required (FR-3.4)
  console.log("\n[Test 3] Simulasikan HTTP 402 pada Key A (kuota habis)...");
  const mock402Error = { statusCode: 402, message: "Payment Required" };
  const res402 = await handleKeyError(keyA.id, mock402Error);

  if (!res402.rotated || !res402.isPaymentRequired) {
    throw new Error("handleKeyError gagal mendeteksi HTTP 402");
  }

  const keyACheck = await prisma.apifyApiKey.findUnique({ where: { id: keyA.id } });
  if (keyACheck?.status !== "exhausted") {
    throw new Error(`Key A harusnya 'exhausted', tetapi: ${keyACheck?.status}`);
  }
  console.log("[Test 3 PASS] Key A otomatis ditandai 'exhausted'.");

  // Worker otomatis pindah ke Key B
  console.log("Meminta key berikutnya (harus otomatis pindah ke Key B)...");
  const secondPick = await getNextActiveApifyKey();
  if (secondPick?.keyId !== keyB.id) {
    throw new Error(`Ekspektasi Key B (#${keyB.id}), didapat: #${secondPick?.keyId}`);
  }
  console.log(`[Test 3 PASS] Sukses rotasi! Worker berpindah ke Key B (#${keyB.id}).`);

  // 4. Test: Simulasikan HTTP 401/403 pada Key B (FR-3.5)
  console.log("\n[Test 4] Simulasikan HTTP 401 pada Key B (token invalid)...");
  const mock401Error = { statusCode: 401, message: "Unauthorized token" };
  const res401 = await handleKeyError(keyB.id, mock401Error);

  if (!res401.rotated || res401.isPaymentRequired) {
    throw new Error("handleKeyError gagal mendeteksi HTTP 401");
  }

  const keyBCheck = await prisma.apifyApiKey.findUnique({ where: { id: keyB.id } });
  if (keyBCheck?.status !== "invalid") {
    throw new Error(`Key B harusnya 'invalid', tetapi: ${keyBCheck?.status}`);
  }
  console.log("[Test 4 PASS] Key B otomatis ditandai 'invalid'.");

  // 5. Test: Auto-Pause ketika semua key non-aktif (FR-3.7)
  console.log("\n[Test 5] Memeriksa kondisi seluruh key non-aktif...");
  const isPaused = await checkAllKeysNonActive();
  const ctrl = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
  if (!isPaused || !ctrl?.isPaused || ctrl.pauseReason !== "no_active_apify_keys") {
    throw new Error(`Auto-pause gagal! State: ${JSON.stringify(ctrl)}`);
  }
  console.log("[Test 5 PASS] Sistem otomatis di-pause dengan reason 'no_active_apify_keys'.");

  // 6. Test: Auto-Reaktivasi Key ketika siklus reset lewat (FR-3.6)
  console.log("\n[Test 6] Uji auto-reaktivasi key exhausted yang siklus resetnya sudah lewat...");
  // Buat key C yang exhausted tapi usageCycleEndsAt sudah kemarin
  const keyC = await prisma.apifyApiKey.create({
    data: {
      label: "TEST_KEY_C",
      token: "apify_api_test_token_cccc",
      status: "exhausted",
      monthlyUsageUsd: 5.0,
      maxMonthlyUsageUsd: 5.0,
      usageCycleEndsAt: new Date(Date.now() - 3600000), // 1 jam lalu
    },
  });

  const reactivatedCount = await autoReactivateExhaustedKeys();
  if (reactivatedCount < 1) {
    throw new Error("Auto-reaktivasi gagal mengaktifkan Key C");
  }

  const keyCCheck = await prisma.apifyApiKey.findUnique({ where: { id: keyC.id } });
  if (keyCCheck?.status !== "active" || keyCCheck?.monthlyUsageUsd?.toNumber() !== 0) {
    throw new Error(`Key C harusnya kembali 'active' dengan usage 0, status: ${keyCCheck?.status}`);
  }
  console.log("[Test 6 PASS] Key C berhasil di-reaktivasi menjadi 'active' otomatis.");

  // Bersihkan data test
  await prisma.apifyApiKey.deleteMany({
    where: { label: { startsWith: "TEST_" } },
  });

  // Reset control pause
  await prisma.scrapeControl.update({
    where: { id: 1 },
    data: { isPaused: false, pauseReason: null },
  });

  console.log("\n=== SELURUH UJI FASE 2 SUKSES 100% ===");
}

testFase2()
  .catch((err) => {
    console.error("Test Fase 2 Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
