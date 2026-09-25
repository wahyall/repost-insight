import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "@repostinsight/db";

export const dynamic = "force-dynamic";

function normalizeMediaType(
  mediaType: string | null,
  rawJson: unknown
): "Video" | "Image" | "Sidecar" {
  if (rawJson && typeof rawJson === "object") {
    const obj = rawJson as Record<string, unknown>;
    if (
      obj.is_video === true ||
      (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) ||
      obj.product_type === "clips" ||
      obj.media_type === 2
    ) {
      return "Video";
    }
    if (
      obj.media_type === 8 ||
      obj.product_type === "carousel_container" ||
      (Array.isArray(obj.carousel_media) && obj.carousel_media.length > 0)
    ) {
      return "Sidecar";
    }
  }

  const mt = String(mediaType || "").toLowerCase();
  if (mt === "2" || mt === "video" || mt === "clips") return "Video";
  if (mt === "8" || mt === "sidecar" || mt === "carousel") return "Sidecar";
  return "Image";
}

function extractThumbnail(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const obj = rawJson as Record<string, unknown>;

  if (typeof obj.thumbnail_url === "string") return obj.thumbnail_url;
  if (typeof obj.display_url === "string") return obj.display_url;

  const imageVersions = obj.image_versions2 as { candidates?: Array<{ url?: string }> } | undefined;
  if (imageVersions?.candidates?.[0]?.url) {
    return imageVersions.candidates[0].url;
  }

  const carouselMedia = obj.carousel_media as Array<{
    image_versions2?: { candidates?: Array<{ url?: string }> };
    display_url?: string;
  }> | undefined;

  if (carouselMedia?.[0]?.image_versions2?.candidates?.[0]?.url) {
    return carouselMedia[0].image_versions2.candidates[0].url;
  }
  if (carouselMedia?.[0]?.display_url) {
    return carouselMedia[0].display_url;
  }

  return null;
}

function extractVideoUrl(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const obj = rawJson as Record<string, unknown>;

  // 1. Direct video_versions array
  const videoVersions = obj.video_versions as Array<{ url?: string }> | undefined;
  if (videoVersions && videoVersions.length > 0) {
    const best = videoVersions.find((v) => typeof v?.url === "string");
    if (best?.url) return best.url;
  }

  // 2. Direct video_url string
  if (typeof obj.video_url === "string") return obj.video_url;

  // 3. Carousel media item with video
  const carousel = obj.carousel_media as Array<{
    video_versions?: Array<{ url?: string }>;
    video_url?: string;
  }> | undefined;

  if (carousel && carousel.length > 0) {
    for (const item of carousel) {
      if (item.video_versions && item.video_versions.length > 0) {
        const best = item.video_versions.find((v) => typeof v?.url === "string");
        if (best?.url) return best.url;
      }
      if (typeof item.video_url === "string") return item.video_url;
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const followerQuery = searchParams.get("follower")?.trim();
    const searchQuery = searchParams.get("search")?.trim();
    const mediaType = searchParams.get("mediaType")?.trim();
    const hasVisual = searchParams.get("hasVisual")?.trim();
    const sort = searchParams.get("sort") || "most_reposts";

    // 1. Build post filter if search / mediaType / hasVisual is provided
    const postConditions: Prisma.PostWhereInput[] = [];

    if (searchQuery) {
      const cleanTag = searchQuery.toLowerCase().replace(/^#/, "");
      postConditions.push({
        OR: [
          { captionText: { contains: searchQuery, mode: "insensitive" } },
          { ownerUsername: { contains: searchQuery, mode: "insensitive" } },
          { hashtags: { has: cleanTag } },
        ],
      });
    }

    if (mediaType && mediaType !== "all") {
      if (mediaType === "Video") {
        postConditions.push({
          OR: [
            { mediaType: { in: ["2", "Video", "video", "clips", "Clips"] } },
            { rawJson: { path: ["is_video"], equals: true } },
            { rawJson: { path: ["product_type"], equals: "clips" } },
            { rawJson: { path: ["media_type"], equals: 2 } },
          ],
        });
      } else if (mediaType === "Sidecar") {
        postConditions.push({
          OR: [
            { mediaType: { in: ["8", "Sidecar", "sidecar", "Carousel", "carousel"] } },
            { rawJson: { path: ["product_type"], equals: "carousel_container" } },
            { rawJson: { path: ["media_type"], equals: 8 } },
          ],
        });
      } else if (mediaType === "Image") {
        postConditions.push({
          OR: [
            { mediaType: { in: ["1", "Image", "image", "Photo", "photo"] } },
            { rawJson: { path: ["media_type"], equals: 1 } },
            { rawJson: { path: ["product_type"], equals: "feed" } },
          ],
        });
      }
    }

    if (hasVisual && hasVisual !== "all") {
      if (hasVisual === "done") {
        postConditions.push({ visualDescriptionStatus: "done" });
      } else if (hasVisual === "pending") {
        postConditions.push({ visualDescriptionStatus: "pending" });
      } else if (hasVisual === "failed") {
        postConditions.push({ visualDescriptionStatus: "failed" });
      }
    }

    const postWhere: Prisma.PostWhereInput | undefined =
      postConditions.length > 0 ? { AND: postConditions } : undefined;

    // 2. Build follower filter
    const followerWhere: Prisma.FollowerWhereInput = {
      repostEvents: {
        some: postWhere ? { post: postWhere } : {},
      },
    };

    if (followerQuery) {
      followerWhere.username = {
        contains: followerQuery,
        mode: "insensitive",
      };
    }

    // 3. Sorting
    let orderBy: Prisma.FollowerOrderByWithRelationInput = {
      repostEvents: { _count: "desc" },
    };
    if (sort === "latest_scraped") {
      orderBy = { lastScrapedAt: "desc" };
    } else if (sort === "username_asc") {
      orderBy = { username: "asc" };
    }

    // 4. Parallel queries for stats + paginated list
    const [
      totalFollowersWithReposts,
      totalEvents,
      totalPosts,
      totalVisualDone,
      totalFilteredFollowers,
      rawFollowers,
    ] = await Promise.all([
      prisma.follower.count({ where: { repostEvents: { some: {} } } }),
      prisma.repostEvent.count(),
      prisma.post.count(),
      prisma.post.count({ where: { visualDescriptionStatus: "done" } }),
      prisma.follower.count({ where: followerWhere }),
      prisma.follower.findMany({
        where: followerWhere,
        orderBy,
        take: limit,
        skip: (page - 1) * limit,
        include: {
          _count: {
            select: { repostEvents: true },
          },
          repostEvents: {
            where: postWhere ? { post: postWhere } : undefined,
            include: {
              post: {
                select: {
                  id: true,
                  code: true,
                  ownerUsername: true,
                  captionText: true,
                  hashtags: true,
                  mediaType: true,
                  likeCount: true,
                  playCount: true,
                  takenAt: true,
                  rawJson: true,
                  visualDescription: true,
                  visualDescriptionStatus: true,
                  embeddingStatus: true,
                },
              },
            },
            orderBy: {
              scrapedAt: "desc",
            },
          },
        },
      }),
    ]);

    // 5. Clean map payload without rawJson bloat
    const followers = rawFollowers.map((f) => {
      const reposts = f.repostEvents.map((re) => {
        const p = re.post;
        const normalizedType = normalizeMediaType(p.mediaType, p.rawJson);
        const videoUrl = normalizedType === "Video" ? extractVideoUrl(p.rawJson) : null;

        return {
          eventId: re.id,
          scrapedAt: re.scrapedAt.toISOString(),
          post: {
            id: p.id,
            code: p.code,
            ownerUsername: p.ownerUsername,
            captionText: p.captionText,
            hashtags: p.hashtags,
            mediaType: normalizedType,
            likeCount: p.likeCount,
            playCount: p.playCount,
            takenAt: p.takenAt ? p.takenAt.toISOString() : null,
            thumbnailUrl: extractThumbnail(p.rawJson),
            videoUrl,
            visualDescription: p.visualDescription,
            visualDescriptionStatus: p.visualDescriptionStatus,
            embeddingStatus: p.embeddingStatus,
          },
        };
      });

      // Extract unique original owners for quick preview badges
      const originalCreators = Array.from(
        new Set(
          reposts
            .map((r) => r.post.ownerUsername)
            .filter((u): u is string => Boolean(u))
        )
      );

      return {
        username: f.username,
        status: f.status,
        lastScrapedAt: f.lastScrapedAt ? f.lastScrapedAt.toISOString() : null,
        createdAt: f.createdAt.toISOString(),
        totalReposts: f._count.repostEvents,
        matchingRepostsCount: reposts.length,
        originalCreators,
        reposts,
      };
    });

    return NextResponse.json({
      summary: {
        totalFollowersWithReposts,
        totalEvents,
        totalPosts,
        totalVisualDone,
        avgRepostsPerFollower:
          totalFollowersWithReposts > 0
            ? Number((totalEvents / totalFollowersWithReposts).toFixed(1))
            : 0,
      },
      pagination: {
        page,
        limit,
        totalFollowers: totalFilteredFollowers,
        totalPages: Math.ceil(totalFilteredFollowers / limit) || 1,
      },
      followers,
    });
  } catch (err: unknown) {
    console.error("[API] Error fetching grouped reposts:", err);
    return NextResponse.json(
      {
        error: "Gagal memuat katalog repost",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
