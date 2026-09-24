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

    await prisma.openRouterApiKey.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: `OpenRouter Key #${id} berhasil dihapus.`,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal menghapus API Key OpenRouter", details: String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }

    // Reaktivasi manual: reset status ke active
    const updated = await prisma.openRouterApiKey.update({
      where: { id },
      data: { status: "active", rateLimitedUntil: null, lastCheckedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      message: `Key #${id} berhasil diaktifkan kembali.`,
      status: updated.status,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal mengaktifkan ulang API Key", details: String(err) },
      { status: 500 }
    );
  }
}
