import { NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function POST() {
  try {
    const control = await prisma.scrapeControl.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        isPaused: false,
        pauseReason: null,
      },
      update: {
        isPaused: false,
        pauseReason: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Proses scraping berhasil dilanjutkan (resume).",
      control,
    });
  } catch (err: unknown) {
    console.error("[API] Gagal resume scraping:", err);
    return NextResponse.json(
      { error: "Gagal melanjutkan proses scraping", details: String(err) },
      { status: 500 }
    );
  }
}
