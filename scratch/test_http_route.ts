import { NextRequest } from "next/server";
import { POST } from "../apps/web/app/api/followers/import/route";
import { prisma } from "../packages/db";

async function testHttpRoute() {
  console.log("=== TEST HTTP ROUTE HANDLER /api/followers/import ===");

  // 1. Test empty body
  console.log("\n[Test 1] Kirim request dengan body kosong...");
  const emptyReq = new NextRequest("http://localhost:3000/api/followers/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "",
  });
  const resEmpty = await POST(emptyReq);
  const dataEmpty = await resEmpty.json();
  console.log("Status:", resEmpty.status, "Respons:", dataEmpty);
  if (resEmpty.status !== 400 || !dataEmpty.error) {
    throw new Error("Ekspektasi HTTP 400 untuk body kosong gagal");
  }
  console.log("[Test 1 PASS] Body kosong ditolak dengan HTTP 400.");

  // 2. Test invalid JSON
  console.log("\n[Test 2] Kirim request dengan JSON rusak...");
  const brokenReq = new NextRequest("http://localhost:3000/api/followers/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ broken json: 123 ",
  });
  const resBroken = await POST(brokenReq);
  const dataBroken = await resBroken.json();
  console.log("Status:", resBroken.status, "Respons:", dataBroken);
  if (resBroken.status !== 400 || !dataBroken.error) {
    throw new Error("Ekspektasi HTTP 400 untuk JSON rusak gagal");
  }
  console.log("[Test 2 PASS] JSON rusak ditolak dengan HTTP 400.");

  // 3. Test valid JSON payload
  console.log("\n[Test 3] Kirim request dengan JSON valid...");
  const validPayload = [
    { string_list_data: [{ value: "route_test_user_1" }] },
    { string_list_data: [{ value: "route_test_user_2" }] },
  ];
  const validReq = new NextRequest("http://localhost:3000/api/followers/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  const resValid = await POST(validReq);
  const dataValid = await resValid.json();
  console.log("Status:", resValid.status, "Respons:", dataValid);
  if (resValid.status !== 200 || !dataValid.success || dataValid.summary.newFollowers !== 2) {
    throw new Error("Ekspektasi HTTP 200 dan 2 follower baru gagal");
  }
  console.log("[Test 3 PASS] JSON valid berhasil diimpor.");

  // 4. Test re-import via route
  console.log("\n[Test 4] Re-import payload yang sama...");
  const reimportReq = new NextRequest("http://localhost:3000/api/followers/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  const resReimport = await POST(reimportReq);
  const dataReimport = await resReimport.json();
  console.log("Status:", resReimport.status, "Respons:", dataReimport);
  if (
    resReimport.status !== 200 ||
    dataReimport.summary.newFollowers !== 0 ||
    dataReimport.summary.alreadyExisting !== 2
  ) {
    throw new Error("Ekspektasi 0 baru dan 2 alreadyExisting pada re-import gagal");
  }
  console.log("[Test 4 PASS] Re-import berhasil dideteksi sebagai alreadyExisting tanpa error.");

  // Cleanup test users
  await prisma.follower.deleteMany({
    where: { username: { in: ["route_test_user_1", "route_test_user_2"] } },
  });

  console.log("\n=== SELURUH UJI HTTP ROUTE HANDLER SUKSES ===");
}

testHttpRoute()
  .catch((err) => {
    console.error("Test HTTP Route Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
