import { NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function GET() {
  try {
    const counts = await prisma.post.groupBy({
      by: ["embeddingStatus"],
      _count: {
        id: true,
      },
    });

    let pending = 0;
    let done = 0;

    for (const c of counts) {
      if (c.embeddingStatus === "pending") pending = c._count.id;
      if (c.embeddingStatus === "done") done = c._count.id;
    }

    return NextResponse.json({
      summary: {
        pending,
        done,
        total: pending + done,
        percentDone: pending + done > 0 ? Math.round((done / (pending + done)) * 100) : 100,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal memuat status embedding", details: String(err) },
      { status: 500 }
    );
  }
}
