import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/followers/rescrape-all
 *
 * Reset semua (atau subset) followers ke status `pending` agar
 * worker scraping mengerjakan ulang dari awal.
 *
 * Body JSON (opsional):
 *   { "scope": "all" | "done" | "failed" }
 *   Default: "done" — hanya reset follower yang sudah selesai (status done).
 *
 * Follower yang sedang in_progress TIDAK direset (run Apify masih berjalan
 * di server mereka; membiarkannya selesai lebih hemat kuota).
 */
export async function POST(req: NextRequest) {
  try {
    let scope: "all" | "done" | "failed" = "done";

    try {
      const body = await req.json();
      if (body?.scope === "all" || body?.scope === "failed") {
        scope = body.scope;
      } else if (body?.scope === "done") {
        scope = "done";
      }
    } catch {
      // Body kosong atau bukan JSON — pakai default
    }

    // Tentukan filter status yang akan direset.
    // in_progress TIDAK disertakan — jangan ganggu run aktif.
    let whereStatus: string[] = [];
    if (scope === "all") {
      whereStatus = ["pending", "done", "failed"];
    } else if (scope === "done") {
      whereStatus = ["done"];
    } else if (scope === "failed") {
      whereStatus = ["failed"];
    }

    const { count } = await prisma.follower.updateMany({
      where: {
        status: { in: whereStatus },
      },
      data: {
        status: "pending",
        retryCount: 0,
        apifyRunId: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `${count} follower berhasil direset ke status pending untuk di-scrape ulang.`,
      count,
      scope,
    });
  } catch (err: unknown) {
    console.error("[API] Error pada rescrape-all:", err);
    return NextResponse.json(
      {
        error: "Gagal mereset followers untuk re-scrape",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
