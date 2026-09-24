import { prisma } from "../packages/db";

async function run() {
  const [followers, posts, repostEvents, keys, control] = await Promise.all([
    prisma.follower.count(),
    prisma.post.count(),
    prisma.repostEvent.count(),
    prisma.apifyApiKey.count(),
    prisma.scrapeControl.findUnique({ where: { id: 1 } }),
  ]);

  console.log("Current DB State:", {
    followers,
    posts,
    repostEvents,
    keys,
    control,
  });
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
