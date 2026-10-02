import { NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";

export async function checkApifyLimits(id: number) {
  const key = await prisma.apifyApiKey.findUnique({
    where: { id },
  });

  if (!key) {
    return NextResponse.json({ error: `API Key #${id} tidak ditemukan` }, { status: 404 });
  }

  try {
    const verifyRes = await fetch("https://api.apify.com/v2/users/me/limits", {
      headers: { Authorization: `Bearer ${key.token}` },
    });

    if (verifyRes.status === 401 || verifyRes.status === 403) {
      await prisma.apifyApiKey.update({
        where: { id },
        data: {
          status: "invalid",
          lastCheckedAt: new Date(),
        },
      });

      const activeCount = await prisma.apifyApiKey.count({ where: { status: "active" } });
      if (activeCount === 0) {
        await prisma.scrapeControl.upsert({
          where: { id: 1 },
          create: { id: 1, isPaused: true, pauseReason: "no_active_apify_keys" },
          update: { isPaused: true, pauseReason: "no_active_apify_keys" },
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: "Token Apify ditolak atau kedaluwarsa (HTTP 401/403). Status diubah menjadi invalid.",
          key: {
            id: key.id,
            label: key.label,
            status: "invalid",
            lastCheckedAt: new Date(),
          },
        },
        { status: 400 }
      );
    }

    if (!verifyRes.ok) {
      return NextResponse.json(
        { error: `Server Apify merespons status HTTP ${verifyRes.status}` },
        { status: verifyRes.status }
      );
    }

    const json = await verifyRes.json();
    const currentUsage =
      typeof json.data?.current?.monthlyUsageUsd === "number"
        ? json.data.current.monthlyUsageUsd
        : 0;
    const maxUsage =
      typeof json.data?.limits?.maxMonthlyUsageUsd === "number"
        ? json.data.limits.maxMonthlyUsageUsd
        : 5.0;

    let cycleEndsAt: Date | null = null;
    const endAtStr = json.data?.monthlyUsageCycle?.endAt;
    if (endAtStr) {
      cycleEndsAt = new Date(endAtStr);
    }

    let newStatus = "active";
    if (maxUsage > 0 && ((maxUsage - currentUsage) / maxUsage) * 100 <= 5) {
      newStatus = "exhausted";
    }

    const updated = await prisma.apifyApiKey.update({
      where: { id },
      data: {
        status: newStatus,
        monthlyUsageUsd: currentUsage,
        maxMonthlyUsageUsd: maxUsage,
        usageCycleEndsAt: cycleEndsAt,
        lastCheckedAt: new Date(),
      },
    });

    if (newStatus === "active") {
      const control = await prisma.scrapeControl.findUnique({ where: { id: 1 } });
      if (control?.isPaused && control.pauseReason === "no_active_apify_keys") {
        await prisma.scrapeControl.update({
          where: { id: 1 },
          data: { isPaused: false, pauseReason: null },
        });
      }
    } else if (newStatus === "exhausted") {
      const activeCount = await prisma.apifyApiKey.count({ where: { status: "active" } });
      if (activeCount === 0) {
        await prisma.scrapeControl.upsert({
          where: { id: 1 },
          create: { id: 1, isPaused: true, pauseReason: "no_active_apify_keys" },
          update: { isPaused: true, pauseReason: "no_active_apify_keys" },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Limit API Key #${id} (${key.label || "Key"}) berhasil diperbarui: $${currentUsage.toFixed(2)} / $${maxUsage.toFixed(2)} (Status: ${
        newStatus === "active" ? "Aktif" : "Kuota Habis"
      })`,
      key: {
        id: updated.id,
        label: updated.label,
        status: updated.status,
        monthlyUsageUsd: Number(updated.monthlyUsageUsd),
        maxMonthlyUsageUsd: Number(updated.maxMonthlyUsageUsd),
        usageCycleEndsAt: updated.usageCycleEndsAt,
        lastCheckedAt: updated.lastCheckedAt,
      },
      limits: json.data,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: "Gagal menghubungi server Apify untuk memeriksa limit.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
