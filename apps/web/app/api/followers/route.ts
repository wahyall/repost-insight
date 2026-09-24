import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const countOnly = searchParams.get("countOnly") === "true";

    // Summary counts by status
    const statusCountsRaw = await prisma.follower.groupBy({
      by: ["status"],
      _count: {
        username: true,
      },
    });

    const statusCounts: Record<string, number> = {
      pending: 0,
      in_progress: 0,
      done: 0,
      failed: 0,
      total: 0,
    };

    let total = 0;
    for (const item of statusCountsRaw) {
      statusCounts[item.status] = item._count.username;
      total += item._count.username;
    }
    statusCounts.total = total;

    if (countOnly) {
      return NextResponse.json({ summary: statusCounts });
    }

    const where = status ? { status } : {};
    const [items, totalFiltered] = await Promise.all([
      prisma.follower.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.follower.count({ where }),
    ]);

    return NextResponse.json({
      summary: statusCounts,
      pagination: {
        page,
        limit,
        totalItems: totalFiltered,
        totalPages: Math.ceil(totalFiltered / limit),
      },
      followers: items,
    });
  } catch (err: unknown) {
    console.error("[API] Error fetching followers:", err);
    return NextResponse.json(
      {
        error: "Gagal mengambil data followers",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
