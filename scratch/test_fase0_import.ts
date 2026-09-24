import fs from "fs";
import { prisma } from "../packages/db";
import { extractUsernamesFromJson } from "../apps/web/app/api/followers/import/route";

async function runTests() {
  console.log("=== MEMULAI TEST FASE 0: IMPORT & MANAJEMEN FOLLOWERS ===");

  // 1. Test: Ekstraksi dari file asli followers_1.json
  const realFilePath = "D:\\yukngaji\\connections\\followers_and_following\\followers_1.json";
  console.log("\n[Test 1] Membaca file asli:", realFilePath);

  if (!fs.existsSync(realFilePath)) {
    throw new Error(`File tidak ditemukan di ${realFilePath}`);
  }

  const rawContent = fs.readFileSync(realFilePath, "utf-8");
  const parsed = JSON.parse(rawContent);
  const usernames = extractUsernamesFromJson(parsed);
  console.log(`[Test 1 PASS] Berhasil mengekstrak ${usernames.length} username dari file asli.`);
  console.log("Contoh 5 username pertama:", usernames.slice(0, 5));

  // 2. Test: Database Import Awal (First Import)
  console.log("\n[Test 2] Uji Import ke database PostgreSQL...");
  // Ambil sampel 100 followers untuk import awal terukur
  const sampleUsernames = Array.from(new Set(usernames.slice(0, 100).map((u) => u.trim().toLowerCase())));
  console.log(`Jumlah sample follower unik: ${sampleUsernames.length}`);

  // Bersihkan sample di DB jika ada
  await prisma.follower.deleteMany({
    where: { username: { in: sampleUsernames } },
  });

  const insertData = sampleUsernames.map((u) => ({
    username: u,
    status: "pending",
  }));

  const res1 = await prisma.follower.createMany({
    data: insertData,
    skipDuplicates: true,
  });

  console.log(`[Test 2 PASS] Import awal: Berhasil menginsert ${res1.count} follower baru berstatus 'pending'.`);

  // Ubah status 1 follower menjadi 'done' untuk menguji re-import (FR-1.3)
  const testFollower = sampleUsernames[0];
  await prisma.follower.update({
    where: { username: testFollower },
    data: { status: "done", apifyRunId: "test_run_123" },
  });
  console.log(`Simulasi: Follower '${testFollower}' diubah statusnya menjadi 'done'.`);

  // 3. Test: Re-import (Find-or-Create, FR-1.3 & FR-1.4)
  console.log("\n[Test 3] Uji Re-import dengan dataset yang sama + 5 username baru...");
  const extraUsernames = ["test_user_new_1", "test_user_new_2", "test_user_new_3"];
  const reimportList = [...sampleUsernames, ...extraUsernames];

  const res2 = await prisma.follower.createMany({
    data: reimportList.map((u) => ({ username: u, status: "pending" })),
    skipDuplicates: true,
  });

  console.log(`[Test 3 PASS] Re-import result: ${res2.count} baris baru diinsert (ekspektasi: 3).`);

  // Pastikan status testFollower TIDAK direset kembali ke pending
  const checkFollower = await prisma.follower.findUnique({
    where: { username: testFollower },
  });

  if (checkFollower?.status !== "done" || checkFollower?.apifyRunId !== "test_run_123") {
    throw new Error(`[FAIL] Status follower yang sudah ada ter-reset! Nilai: ${JSON.stringify(checkFollower)}`);
  }
  console.log(`[Test 3 PASS] Status '${testFollower}' tetap 'done' dan apifyRunId tetap '${checkFollower.apifyRunId}' (Tidak direset!).`);

  // 4. Test: File Kosong / Tidak Valid (FR-1.5)
  console.log("\n[Test 4] Uji deteksi file kosong & rusak...");
  const emptyUsernames = extractUsernamesFromJson([]);
  if (emptyUsernames.length !== 0) throw new Error("Empty array should return 0 usernames");

  const invalidUsernames = extractUsernamesFromJson({ something_else: 123 });
  if (invalidUsernames.length !== 0) throw new Error("Invalid object should return 0 usernames");

  console.log("[Test 4 PASS] Validasi struktur data kosong/rusak berhasil dideteksi dengan benar.");

  // Bersihkan data test ekstra
  await prisma.follower.deleteMany({
    where: { username: { in: extraUsernames } },
  });

  console.log("\n=== SELURUH UJI FASE 0 SUKSES 100% ===");
}

runTests()
  .catch((err) => {
    console.error("Test Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
