import { NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function GET() {
  try {
    const messages = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal memuat riwayat percakapan", details: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await prisma.chatMessage.deleteMany();
    return NextResponse.json({ success: true, message: "Riwayat chat berhasil dibersihkan." });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal menghapus riwayat chat", details: String(err) },
      { status: 500 }
    );
  }
}
