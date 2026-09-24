import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { username: string } }
) {
  try {
    const username = decodeURIComponent(params.username).trim().toLowerCase();

    const follower = await prisma.follower.findUnique({
      where: { username },
    });

    if (!follower) {
      return NextResponse.json(
        { error: `Follower @${username} tidak ditemukan` },
        { status: 404 }
      );
    }

    const updated = await prisma.follower.update({
      where: { username },
      data: {
        status: "pending",
        retryCount: 0,
        apifyRunId: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Follower @${username} berhasil di-reset untuk dicoba ulang (status: pending).`,
      follower: updated,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal me-retry follower", details: String(err) },
      { status: 500 }
    );
  }
}
