import { NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Overview counts
    const [totalFollowers, doneFollowers, totalPosts, totalRepostEvents, embeddingCounts] =
      await Promise.all([
        prisma.follower.count(),
        prisma.follower.count({ where: { status: "done" } }),
        prisma.post.count(),
        prisma.repostEvent.count(),
        prisma.post.groupBy({
          by: ["embeddingStatus"],
          _count: { id: true },
        }),
      ]);

    let embeddingPending = 0;
    let embeddingDone = 0;
    for (const ec of embeddingCounts) {
      if (ec.embeddingStatus === "pending") embeddingPending = ec._count.id;
      if (ec.embeddingStatus === "done") embeddingDone = ec._count.id;
    }

    // 2. Query Materialized Views (Fast, non-blocking, FR-7.1, FR-7.2)
    const [topAccounts, trendingHashtags, timeline] = await Promise.all([
      prisma.$queryRawUnsafe<
        {
          owner_username: string;
          repost_count: number;
          unique_followers_count: number;
          total_likes: string | number;
          total_plays: string | number;
        }[]
      >(`SELECT * FROM mv_top_reposted_accounts LIMIT 10;`),
      prisma.$queryRawUnsafe<
        {
          tag: string;
          usage_count: number;
          unique_reposters_count: number;
        }[]
      >(`SELECT * FROM mv_trending_hashtags LIMIT 15;`),
      prisma.$queryRawUnsafe<
        {
          activity_date: string;
          repost_count: number;
          active_followers_count: number;
        }[]
      >(`SELECT * FROM mv_repost_activity_timeline ORDER BY activity_date ASC LIMIT 30;`),
    ]);

    const formattedTopAccounts = topAccounts.map((a) => ({
      ownerUsername: a.owner_username,
      repostCount: Number(a.repost_count),
      uniqueFollowersCount: Number(a.unique_followers_count),
      totalLikes: Number(a.total_likes),
      totalPlays: Number(a.total_plays),
    }));

    const formattedHashtags = trendingHashtags.map((h) => ({
      tag: h.tag,
      usageCount: Number(h.usage_count),
      uniqueRepostersCount: Number(h.unique_reposters_count),
    }));

    const formattedTimeline = timeline.map((t) => ({
      date: new Date(t.activity_date).toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
      }),
      repostCount: Number(t.repost_count),
      activeFollowers: Number(t.active_followers_count),
    }));

    return NextResponse.json({
      overview: {
        totalFollowers,
        doneFollowers,
        totalPosts,
        totalRepostEvents,
        embeddingPending,
        embeddingDone,
        embeddingPercent:
          totalPosts > 0 ? Math.round((embeddingDone / totalPosts) * 100) : 100,
      },
      topAccounts: formattedTopAccounts,
      trendingHashtags: formattedHashtags,
      timeline: formattedTimeline,
    });
  } catch (err: unknown) {
    console.error("[API] Error fetching dashboard summary:", err);
    return NextResponse.json(
      { error: "Gagal memuat ringkasan dashboard", details: String(err) },
      { status: 500 }
    );
  }
}

/**
 * Endpoint to trigger manual or scheduled refresh of Materialized Views (FR-7.2)
 */
export async function POST() {
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_reposted_accounts;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_hashtags;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_repost_activity_timeline;`);

    return NextResponse.json({
      success: true,
      message: "Materialized views berhasil di-refresh.",
    });
  } catch (err: unknown) {
    console.error("[API] Error refreshing materialized views:", err);
    return NextResponse.json(
      { error: "Gagal me-refresh materialized views", details: String(err) },
      { status: 500 }
    );
  }
}
