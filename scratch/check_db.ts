import { prisma } from "../packages/db";

async function inspect() {
  const [followers, posts, repostEvents] = await Promise.all([
    prisma.follower.findMany({ select: { username: true, status: true } }),
    prisma.post.count(),
    prisma.repostEvent.count(),
  ]);

  const mvTop = await prisma.$queryRawUnsafe(`SELECT * FROM mv_top_reposted_accounts LIMIT 5;`);
  const rawTop = await prisma.$queryRawUnsafe(`
    SELECT p.owner_username, COUNT(re.id) as repost_count
    FROM repost_events re
    JOIN posts p ON re.post_id = p.id
    GROUP BY p.owner_username
    ORDER BY repost_count DESC
    LIMIT 5;
  `);

  console.log("Followers:", followers);
  console.log("Posts count:", posts);
  console.log("RepostEvents count:", repostEvents);
  console.log("Materialized view mv_top_reposted_accounts:", mvTop);
  console.log("Raw query top accounts:", rawTop);
}

inspect()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
