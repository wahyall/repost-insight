import { prisma } from "../packages/db";

async function main() {
  const counts = await prisma.post.groupBy({
    by: ["commentsStatus"],
    _count: { id: true },
  });
  console.log("Post commentsStatus counts:", counts);
  const sample = await prisma.post.findFirst({
    select: {
      id: true,
      code: true,
      commentCount: true,
      commentsStatus: true,
      commentSummary: true,
    },
  });
  console.log("Sample post:", sample);
}

main().finally(() => prisma.$disconnect());
