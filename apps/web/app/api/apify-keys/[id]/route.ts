import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }

    await prisma.apifyApiKey.delete({
      where: { id },
    });

    // Check if any active key remains
    const activeCount = await prisma.apifyApiKey.count({ where: { status: "active" } });
    if (activeCount === 0) {
      await prisma.scrapeControl.update({
        where: { id: 1 },
        data: { isPaused: true, pauseReason: "no_active_apify_keys" },
      });
    }

    return NextResponse.json({
      success: true,
      message: `API Key #${id} berhasil dihapus.`,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal menghapus API Key", details: String(err) },
      { status: 500 }
    );
  }
}
