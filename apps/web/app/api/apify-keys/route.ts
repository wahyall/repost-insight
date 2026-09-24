import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

// Helper to mask token for security (e.g. apify_api_abc...1234)
function maskToken(token: string): string {
  if (token.length <= 10) return "••••••••";
  return `${token.slice(0, 10)}...${token.slice(-4)}`;
}

export async function GET() {
  try {
    const keys = await prisma.apifyApiKey.findMany({
      orderBy: { createdAt: "desc" },
    });

    const maskedKeys = keys.map((k) => ({
      id: k.id,
      label: k.label,
      maskedToken: maskToken(k.token),
      status: k.status,
      monthlyUsageUsd: k.monthlyUsageUsd ? Number(k.monthlyUsageUsd) : 0,
      maxMonthlyUsageUsd: k.maxMonthlyUsageUsd ? Number(k.maxMonthlyUsageUsd) : 5.0,
      usageCycleEndsAt: k.usageCycleEndsAt,
      lastCheckedAt: k.lastCheckedAt,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));

    return NextResponse.json({
      keys: maskedKeys,
      totalActive: keys.filter((k) => k.status === "active").length,
      totalExhausted: keys.filter((k) => k.status === "exhausted").length,
      totalInvalid: keys.filter((k) => k.status === "invalid").length,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal memuat daftar API Key Apify", details: String(err) },
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
      return NextResponse.json({ error: "Token Apify wajib diisi" }, { status: 400 });
    }

    // Verify token validity against Apify API immediately (FR-3.2, FR-3.5)
    let currentUsage = 0;
    let maxUsage = 5.0;
    let cycleEndsAt: Date | null = null;
    let status = "active";

    try {
      const verifyRes = await fetch("https://api.apify.com/v2/users/me/limits", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (verifyRes.status === 401 || verifyRes.status === 403) {
        return NextResponse.json(
          { error: "Token Apify tidak valid atau ditolak oleh server Apify (HTTP 401/403)." },
          { status: 400 }
        );
      }

      if (verifyRes.ok) {
        const json = await verifyRes.json();
        currentUsage = json.data?.current?.monthlyUsageUsd ?? 0;
        maxUsage = json.data?.limits?.maxMonthlyUsageUsd ?? 5.0;
        const endAtStr = json.data?.monthlyUsageCycle?.endAt;
        if (endAtStr) cycleEndsAt = new Date(endAtStr);

        if (maxUsage > 0 && ((maxUsage - currentUsage) / maxUsage) * 100 <= 5) {
          status = "exhausted";
        }
      }
    } catch (checkErr) {
      console.warn("Gagal mengecek kuota ke server Apify saat pembuatan key:", checkErr);
      // Still proceed if network hiccup
    }

    const newKey = await prisma.apifyApiKey.create({
      data: {
        label: label || `Key #${Date.now().toString().slice(-4)}`,
        token,
        status,
        monthlyUsageUsd: currentUsage,
        maxMonthlyUsageUsd: maxUsage,
        usageCycleEndsAt: cycleEndsAt,
        lastCheckedAt: new Date(),
      },
    });

    // If scrape_control was paused due to 'no_active_apify_keys', resume it!
    if (status === "active") {
      const control = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
      if (control?.isPaused && control.pauseReason === "no_active_apify_keys") {
        await prisma.scrapeControl.update({
          where: { id: 1 },
          data: { isPaused: false, pauseReason: null },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "API Key Apify berhasil ditambahkan dan diverifikasi.",
      key: {
        id: newKey.id,
        label: newKey.label,
        maskedToken: maskToken(newKey.token),
        status: newKey.status,
        monthlyUsageUsd: Number(newKey.monthlyUsageUsd),
        maxMonthlyUsageUsd: Number(newKey.maxMonthlyUsageUsd),
        usageCycleEndsAt: newKey.usageCycleEndsAt,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Gagal menyimpan API Key Apify", details: String(err) },
      { status: 500 }
    );
  }
}
