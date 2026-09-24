import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

function maskToken(token: string): string {
  if (token.length <= 10) return "••••••••";
  return `${token.slice(0, 12)}...${token.slice(-4)}`;
}

export async function GET() {
  try {
    const keys = await prisma.openRouterApiKey.findMany({
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const maskedKeys = keys.map((k) => ({
      id: k.id,
      label: k.label,
      maskedToken: maskToken(k.token),
      status: k.status,
      rateLimitedUntil: k.rateLimitedUntil,
      lastCheckedAt: k.lastCheckedAt,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      // sisa waktu rate limit dalam detik
      rateLimitSecondsLeft:
        k.rateLimitedUntil && k.rateLimitedUntil > now
          ? Math.ceil((k.rateLimitedUntil.getTime() - now.getTime()) / 1000)
          : null,
    }));

    return NextResponse.json({
      keys: maskedKeys,
      totalActive: keys.filter((k) => k.status === "active").length,
      totalRateLimited: keys.filter((k) => k.status === "rate_limited").length,
      totalInvalid: keys.filter((k) => k.status === "invalid").length,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal memuat daftar API Key OpenRouter", details: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : null;

    if (!token) {
      return NextResponse.json({ error: "Token OpenRouter wajib diisi" }, { status: 400 });
    }

    // Verifikasi token ke OpenRouter API (cek auth)
    let status = "active";
    try {
      const verifyRes = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (verifyRes.status === 401 || verifyRes.status === 403) {
        return NextResponse.json(
          { error: "Token OpenRouter tidak valid atau ditolak oleh server (HTTP 401/403)." },
          { status: 400 }
        );
      }
      // 200 atau status lain → anggap valid, simpan saja
    } catch (checkErr) {
      console.warn("Gagal verifikasi token ke OpenRouter:", checkErr);
      // Tetap lanjut simpan jika network hiccup
    }

    const newKey = await prisma.openRouterApiKey.create({
      data: {
        label: label || `Key #${Date.now().toString().slice(-4)}`,
        token,
        status,
        lastCheckedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: "API Key OpenRouter berhasil ditambahkan.",
      key: {
        id: newKey.id,
        label: newKey.label,
        maskedToken: maskToken(newKey.token),
        status: newKey.status,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal menyimpan API Key OpenRouter", details: String(err) },
      { status: 500 }
    );
  }
}
