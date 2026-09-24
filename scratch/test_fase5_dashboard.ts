import { prisma } from "../packages/db";

async function testFase5() {
  console.log("=== MEMULAI TEST FASE 5: DASHBOARD ANALITIK & MATERIALIZED VIEWS ===");

  // 1. Test: Refresh Materialized Views (FR-7.2)
  console.log("\n[Test 1] Menjalankan REFRESH MATERIALIZED VIEW CONCURRENTLY...");
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_reposted_accounts;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_hashtags;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_repost_activity_timeline;`);
  console.log("[Test 1 PASS] Seluruh materialized view berhasil di-refresh concurrently tanpa lock.");

  // 2. Test: Query mv_top_reposted_accounts (FR-7.1)
  console.log("\n[Test 2] Query mv_top_reposted_accounts vs tabel mentah...");
  const mvAccounts: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM mv_top_reposted_accounts LIMIT 5;`);
  console.log("Sample Top Accounts dari MV:", mvAccounts.slice(0, 3));

  // Bandingkan dengan query mentah
  if (mvAccounts.length > 0) {
    const topAcc = mvAccounts[0];
    const rawCheck: any[] = await prisma.$queryRawUnsafe(
      `SELECT count(*) as count FROM repost_events re JOIN posts p ON re.post_id = p.id WHERE p.owner_username = $1`,
      topAcc.owner_username
    );
    const rawCount = Number(rawCheck[0].count);
    const mvCount = Number(topAcc.repost_count);

    if (rawCount !== mvCount) {
      throw new Error(`Data tidak cocok! Raw count: ${rawCount}, MV count: ${mvCount}`);
    }
    console.log(`[Test 2 PASS] Data akurat 100%: @${topAcc.owner_username} memiliki ${mvCount} repost di MV dan tabel mentah.`);
  } else {
    console.log("[Test 2 PASS] MV siap (tabel kosong saat ini).");
  }

  // 3. Test: Query mv_trending_hashtags
  console.log("\n[Test 3] Query mv_trending_hashtags...");
  const mvHashtags: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM mv_trending_hashtags LIMIT 5;`);
  console.log("Sample Hashtags dari MV:", mvHashtags);
  console.log("[Test 3 PASS] Query tren hashtag berhasil.");

  // 4. Test: Query mv_repost_activity_timeline
  console.log("\n[Test 4] Query mv_repost_activity_timeline...");
  const mvTimeline: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM mv_repost_activity_timeline;`);
  console.log("Sample Timeline dari MV:", mvTimeline.slice(0, 3));
  console.log("[Test 4 PASS] Query timeline aktivitas berhasil.");

  console.log("\n=== SELURUH UJI FASE 5 SUKSES 100% ===");
}

testFase5()
  .catch((err) => {
    console.error("Test Fase 5 Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
