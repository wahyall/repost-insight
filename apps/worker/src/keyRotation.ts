import { prisma } from "@repostinsight/db";
import { RepostApifyService } from "./apifyClient";

const PROACTIVE_REMAINING_THRESHOLD_PERCENT = 5; // Default 5% remaining threshold

export interface KeyRotationManager {
  getNextActiveService: () => Promise<RepostApifyService | null>;
  handleRunError: (keyId: number, error: unknown) => Promise<boolean>; // returns true if key was rotated
  refreshAllKeyQuotas: () => Promise<void>;
  autoReactivateExhaustedKeys: () => Promise<void>;
}

/**
 * Checks and updates quota for a specific key using Apify /v2/users/me/limits (FR-3.2, FR-3.3, FR-3.5)
 */
export async function refreshKeyQuota(keyId: number, token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.apify.com/v2/users/me/limits", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 || res.status === 403) {
      // FR-3.5: Key invalid
      console.warn(`[KeyRotation] Key #${keyId} mengembalikan HTTP ${res.status}. Ditandai sebagai 'invalid'.`);
      await prisma.apifyApiKey.update({
        where: { id: keyId },
        data: {
          status: "invalid",
          lastCheckedAt: new Date(),
        },
      });
      return false;
    }

    if (!res.ok) {
      console.warn(`[KeyRotation] Key #${keyId} cek kuota gagal dengan status HTTP ${res.status}`);
      return false;
    }

    const json = await res.json();
    const current = json.data?.current?.monthlyUsageUsd;
    const max = json.data?.limits?.maxMonthlyUsageUsd;
    const endAtStr = json.data?.monthlyUsageCycle?.endAt;

    const currentUsd = typeof current === "number" ? current : 0;
    const maxUsd = typeof max === "number" ? max : 5.0; // default free tier $5
    const cycleEndsAt = endAtStr ? new Date(endAtStr) : null;

    let newStatus = "active";

    // Proactive key rotation check (FR-3.3)
    if (maxUsd > 0) {
      const remainingPercent = ((maxUsd - currentUsd) / maxUsd) * 100;
      if (remainingPercent <= PROACTIVE_REMAINING_THRESHOLD_PERCENT) {
        newStatus = "exhausted";
        console.log(`[KeyRotation] Key #${keyId} sisa kuota ${remainingPercent.toFixed(1)}% (<= ${PROACTIVE_REMAINING_THRESHOLD_PERCENT}%). Ditandai 'exhausted' proaktif.`);
      }
    }

    await prisma.apifyApiKey.update({
      where: { id: keyId },
      data: {
        monthlyUsageUsd: currentUsd,
        maxMonthlyUsageUsd: maxUsd,
        usageCycleEndsAt: cycleEndsAt,
        status: newStatus,
        lastCheckedAt: new Date(),
      },
    });

    return newStatus === "active";
  } catch (err) {
    console.error(`[KeyRotation] Error mengecek kuota key #${keyId}:`, err);
    return false;
  }
}

/**
 * Auto-reactivates keys when cycleEndsAt has passed (FR-3.6)
 */
export async function autoReactivateExhaustedKeys(): Promise<number> {
  const now = new Date();
  const expiredKeys = await prisma.apifyApiKey.findMany({
    where: {
      status: "exhausted",
      usageCycleEndsAt: { lt: now },
    },
  });

  let reactivated = 0;
  for (const k of expiredKeys) {
    await prisma.apifyApiKey.update({
      where: { id: k.id },
      data: {
        status: "active",
        monthlyUsageUsd: 0,
      },
    });
    console.log(`[KeyRotation] Key #${k.id} (${k.label || "Unnamed"}) siklus reset telah lewat -> diaktifkan kembali.`);
    reactivated++;
  }

  return reactivated;
}

/**
 * Handles runtime error from Apify run (FR-3.4, FR-3.5)
 */
export async function handleKeyError(keyId: number, error: unknown): Promise<{ rotated: boolean; isPaymentRequired: boolean }> {
  const errStr = String(error);
  const is402 = (error as { statusCode?: number })?.statusCode === 402 || errStr.includes("402") || errStr.includes("Payment Required");
  const isAuthError = (error as { statusCode?: number })?.statusCode === 401 || (error as { statusCode?: number })?.statusCode === 403 || errStr.includes("401") || errStr.includes("403");

  if (is402) {
    console.warn(`[KeyRotation] Key #${keyId} menerima HTTP 402 (Payment Required). Ditandai sebagai 'exhausted'.`);
    await prisma.apifyApiKey.update({
      where: { id: keyId },
      data: {
        status: "exhausted",
        lastCheckedAt: new Date(),
      },
    });
    await checkAllKeysNonActive();
    return { rotated: true, isPaymentRequired: true };
  }

  if (isAuthError) {
    console.warn(`[KeyRotation] Key #${keyId} menerima HTTP 401/403. Ditandai sebagai 'invalid'.`);
    await prisma.apifyApiKey.update({
      where: { id: keyId },
      data: {
        status: "invalid",
        lastCheckedAt: new Date(),
      },
    });
    await checkAllKeysNonActive();
    return { rotated: true, isPaymentRequired: false };
  }

  return { rotated: false, isPaymentRequired: false };
}

/**
 * Checks if all keys are non-active, and automatically pauses the system if so (FR-3.7)
 */
export async function checkAllKeysNonActive(): Promise<boolean> {
  const activeCount = await prisma.apifyApiKey.count({
    where: { status: "active" },
  });

  if (activeCount === 0) {
    console.warn("[KeyRotation] Seluruh API Key Apify non-aktif! Mengubah scrape_control menjadi is_paused = true (FR-3.7).");
    await prisma.scrapeControl.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        isPaused: true,
        pauseReason: "no_active_apify_keys",
      },
      update: {
        isPaused: true,
        pauseReason: "no_active_apify_keys",
      },
    });
    return true;
  }

  return false;
}

/**
 * Selects next active key (least recently used) and returns ApifyService
 */
export async function getNextActiveApifyKey(): Promise<{ service: RepostApifyService; keyId: number } | null> {
  // 1. Re-activate any expired exhausted keys first
  await autoReactivateExhaustedKeys();

  // 2. Find active keys ordered by lastUsedAt ASC
  const keyRecord = await prisma.apifyApiKey.findFirst({
    where: { status: "active" },
    orderBy: [{ lastUsedAt: "asc" }, { id: "asc" }],
  });

  if (keyRecord) {
    // Update lastUsedAt
    await prisma.apifyApiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      service: new RepostApifyService(keyRecord.token),
      keyId: keyRecord.id,
    };
  }

  // 3. Fallback to env var if available and no DB keys exist
  const totalKeys = await prisma.apifyApiKey.count();
  if (totalKeys === 0 && process.env.APIFY_API_KEY) {
    return {
      service: new RepostApifyService(process.env.APIFY_API_KEY),
      keyId: 0,
    };
  }

  // 4. No active keys available
  await checkAllKeysNonActive();
  return null;
}
