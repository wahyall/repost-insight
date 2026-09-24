import { prisma } from "../packages/db";
import { extractHashtags } from "../apps/worker/src/scrapeLoop";

async function backfill() {
  console.log("Memulai perbaikan data 40 posts yang sudah di-scrape...");
  const posts = await prisma.post.findMany();

  let updatedCount = 0;
  for (const post of posts) {
    if (!post.rawJson) continue;
    const item = post.rawJson as any;

    const ownerUsername =
      (item.user?.username || item.ownerUsername || item.originalAuthor || item.original_author || item.owner_username || item.owner?.username || null)?.toString() || null;

    let captionText: string | null = null;
    if (typeof item.caption === "string") {
      captionText = item.caption;
    } else if (typeof item.caption === "object" && item.caption !== null) {
      captionText = (item.caption as any).text || null;
    } else if (typeof item.captionText === "string") {
      captionText = item.captionText;
    } else if (typeof (item as any).text === "string") {
      captionText = (item as any).text;
    }

    const hashtags = extractHashtags(captionText);
    const mediaType = (item.postType || item.media_type || (item as any).media_format || null)?.toString() || null;
    const likeCount = typeof item.likeCount === "number" ? item.likeCount : typeof item.like_count === "number" ? item.like_count : null;
    const playCount = typeof item.playCount === "number" ? item.playCount : typeof item.play_count === "number" ? item.play_count : typeof (item as any).view_count === "number" ? (item as any).view_count : null;

    let takenAt: Date | null = null;
    const rawTakenAt = (item as any).takenAtDate || (item as any).taken_at_date || item.takenAt || item.taken_at;
    if (rawTakenAt) {
      if (typeof rawTakenAt === "number") {
        takenAt = new Date(rawTakenAt > 1e11 ? rawTakenAt : rawTakenAt * 1000);
      } else {
        const parsedDate = new Date(rawTakenAt);
        if (!isNaN(parsedDate.getTime())) takenAt = parsedDate;
      }
    }

    // Set embedding status to pending if caption changed from null so worker will embed it
    const shouldReEmbed = !post.captionText && captionText;

    await prisma.post.update({
      where: { id: post.id },
      data: {
        ownerUsername,
        captionText,
        hashtags,
        mediaType,
        likeCount,
        playCount,
        takenAt,
        embeddingStatus: shouldReEmbed ? "pending" : post.embeddingStatus,
      },
    });

    updatedCount++;
  }

  console.log(`Berhasil memperbarui ${updatedCount} posts dengan data owner & caption yang valid.`);

  // Refresh materialized views
  console.log("Merefresh Materialized Views...");
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_top_reposted_accounts;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_trending_hashtags;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_repost_activity_timeline;`);
  console.log("Materialized views berhasil di-refresh!");

  // Verify top accounts
  const topAccounts: any[] = await prisma.$queryRawUnsafe(`
    SELECT owner_username, repost_count, unique_followers_count
    FROM mv_top_reposted_accounts
    LIMIT 5;
  `);
  console.log("Top Accounts di Materialized View:", topAccounts);
}

backfill()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
