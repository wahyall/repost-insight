import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function GET() {
  try {
    const control = await prisma.scrapeControl.findUnique({
      where: { id: 1 },
    });

    return NextResponse.json({
      control: control || {
        id: 1,
        isPaused: false,
        pauseReason: null,
        maxConcurrency: 3,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal membaca kontrol scraping", details: String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const maxConcurrency =
      typeof body.maxConcurrency === "number" ? Math.max(1, Math.min(10, body.maxConcurrency)) : undefined;

    const control = await prisma.scrapeControl.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        maxConcurrency: maxConcurrency ?? 3,
      },
      update: {
        maxConcurrency: maxConcurrency ?? undefined,
      },
    });

    return NextResponse.json({ success: true, control });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal memperbarui konfigurasi kontrol scraping", details: String(err) },
      { status: 500 }
    );
  }
}
