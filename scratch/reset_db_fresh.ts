import { prisma } from "../packages/db";

async function resetFresh() {
  console.log("==========================================");
  console.log("  RESETTING REPOSTINSIGHT DATABASE (FRESH)");
  console.log("==========================================");

  // Truncate all tables cascade
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      repost_events, 
      posts, 
      followers, 
      apify_api_keys, 
      chat_messages, 
      scrape_control 
    RESTART IDENTITY CASCADE;
  `);

  // Re-insert default row for scrape_control
  await prisma.$executeRawUnsafe(`
    INSERT INTO scrape_control (id, is_paused, pause_reason, max_concurrency)
    VALUES (1, false, null, 3)
    ON CONFLICT (id) DO UPDATE 
    SET is_paused = false, pause_reason = null, max_concurrency = 3;
  `);

  // Refresh materialized views to reflect empty data
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_top_reposted_accounts;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_trending_hashtags;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_repost_activity_timeline;`);

  // Verify counts
  const [followers, posts, repostEvents, keys, messages, control] = await Promise.all([
    prisma.follower.count(),
    prisma.post.count(),
    prisma.repostEvent.count(),
    prisma.apifyApiKey.count(),
    prisma.chatMessage.count(),
    prisma.scrapeControl.findUnique({ where: { id: 1 } }),
  ]);

  console.log("\nDatabase berhasil dikosongkan (Fresh State):");
  console.log({
    followers,
    posts,
    repostEvents,
    apifyApiKeys: keys,
    chatMessages: messages,
    scrapeControl: control,
  });
  console.log("\nStatus: Database bersih 100% dan siap digunakan dari awal!");
}

resetFresh()
  .catch((err) => {
    console.error("Gagal mereset database:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
