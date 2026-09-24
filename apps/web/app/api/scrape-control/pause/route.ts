import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function POST(req: NextRequest) {
  try {
    let reason = "Dijeda manual oleh pengguna";
    try {
      const body = await req.json();
      if (body && typeof body.reason === "string") {
        reason = body.reason;
      }
    } catch {
      // Body may be empty
    }

    const control = await prisma.scrapeControl.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        isPaused: true,
        pauseReason: reason,
      },
      update: {
        isPaused: true,
        pauseReason: reason,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Proses scraping berhasil dijeda (pause). Run yang sedang berjalan akan diselesaikan.",
      control,
    });
  } catch (err: unknown) {
    console.error("[API] Gagal pause scraping:", err);
    return NextResponse.json(
      { error: "Gagal menjeda proses scraping", details: String(err) },
      { status: 500 }
    );
  }
}
