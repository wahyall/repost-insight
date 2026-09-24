import { prisma } from "@repostinsight/db";

/**
 * Menunggu hingga key rate_limited yang paling cepat aktif kembali.
 */
async function waitForEarliestKeyReactivation(): Promise<number> {
  const soonest = await prisma.openRouterApiKey.findFirst({
    where: { status: "rate_limited", rateLimitedUntil: { not: null } },
    orderBy: { rateLimitedUntil: "asc" },
  });

  if (!soonest?.rateLimitedUntil) return 0;

  const waitMs = Math.max(0, soonest.rateLimitedUntil.getTime() - Date.now()) + 500;
  console.warn(
    `[OpenRouterKeyRotation/web] Semua key rate limited. Menunggu ${Math.ceil(waitMs / 1000)}s hingga key #${soonest.id} aktif kembali...`
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return waitMs;
}

/**
 * Mengembalikan key OpenRouter berikutnya yang aktif (round-robin: LRU order).
 * Dipakai di apps/web (API route chat dan tools/semantic search).
 * Logika sama persis dengan openrouterKeyRotation.ts di apps/worker.
 */
export async function getNextActiveOpenRouterKey(): Promise<{ token: string; keyId: number } | null> {
  // 1. Auto-reactivate keys whose rate_limited_until has passed
  const now = new Date();
  await prisma.openRouterApiKey.updateMany({
    where: {
      status: "rate_limited",
      rateLimitedUntil: { lt: now },
    },
    data: { status: "active", rateLimitedUntil: null },
  });

  // 2. Find least-recently-used active key (round-robin via lastUsedAt ASC)
  const keyRecord = await prisma.openRouterApiKey.findFirst({
    where: { status: "active" },
    orderBy: [{ lastUsedAt: "asc" }, { id: "asc" }],
  });

  if (keyRecord) {
    await prisma.openRouterApiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });
    return { token: keyRecord.token, keyId: keyRecord.id };
  }

  // 3. Fallback: env var jika tidak ada key di DB
  const totalKeys = await prisma.openRouterApiKey.count();
  if (totalKeys === 0 && process.env.OPENROUTER_API_KEY) {
    return { token: process.env.OPENROUTER_API_KEY, keyId: 0 };
  }

  return null;
}

/**
 * Menandai key sebagai rate_limited ketika menerima HTTP 429.
 */
export async function markOpenRouterKeyRateLimited(
  keyId: number,
  retryAfterSeconds: number = 60
): Promise<void> {
  if (keyId === 0) return; // env fallback, tidak ada di DB

  const rateLimitedUntil = new Date(Date.now() + retryAfterSeconds * 1000);
  await prisma.openRouterApiKey.update({
    where: { id: keyId },
    data: { status: "rate_limited", rateLimitedUntil, lastCheckedAt: new Date() },
  });
  console.warn(
    `[OpenRouterKeyRotation/web] Key #${keyId} rate limited. Aktif kembali: ${rateLimitedUntil.toISOString()}`
  );
}

/**
 * Menandai key sebagai invalid ketika menerima HTTP 401/403.
 */
export async function markOpenRouterKeyInvalid(keyId: number): Promise<void> {
  if (keyId === 0) return;

  await prisma.openRouterApiKey.update({
    where: { id: keyId },
    data: { status: "invalid", lastCheckedAt: new Date() },
  });
  console.warn(`[OpenRouterKeyRotation/web] Key #${keyId} ditandai invalid.`);
}

/**
 * Wrapper fetch ke OpenRouter dengan otomatis round-robin + retry ke key berikutnya jika 429.
 */
export async function openRouterFetch(
  url: string,
  options: RequestInit,
  maxAttempts: number = 5
): Promise<Response> {
  const triedKeyIds = new Set<number>();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyInfo = await getNextActiveOpenRouterKey();

    if (!keyInfo) {
      // Cek apakah ada key yang sedang rate_limited (bukan benar-benar tidak ada key)
      const rateLimitedCount = await prisma.openRouterApiKey.count({
        where: { status: "rate_limited" },
      });

      if (rateLimitedCount > 0) {
        await waitForEarliestKeyReactivation();
        attempt--; // jangan hitung sebagai percobaan
        continue;
      }

      throw new Error(
        "Tidak ada OpenRouter API Key yang aktif. Tambahkan key di tabel openrouter_api_keys atau set OPENROUTER_API_KEY di .env."
      );
    }

    if (triedKeyIds.has(keyInfo.keyId)) {
      throw new Error("Semua OpenRouter API Key aktif sudah dicoba dan terkena rate limit.");
    }
    triedKeyIds.add(keyInfo.keyId);

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
      Authorization: `Bearer ${keyInfo.token}`,
    };

    const res = await fetch(url, { ...options, headers });

    if (res.status === 429) {
      const retryHeader = res.headers.get("Retry-After");
      const retrySec = retryHeader ? parseInt(retryHeader, 10) : 60;
      const retrySecSafe = isNaN(retrySec) ? 60 : retrySec;
      console.warn(
        `[OpenRouterKeyRotation/web] Key #${keyInfo.keyId} rate limited (429). Rotasi ke key berikutnya...`
      );
      await markOpenRouterKeyRateLimited(keyInfo.keyId, retrySecSafe);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      console.warn(`[OpenRouterKeyRotation/web] Key #${keyInfo.keyId} invalid (${res.status}). Rotasi...`);
      await markOpenRouterKeyInvalid(keyInfo.keyId);
      continue;
    }

    return res;
  }

  throw new Error("[OpenRouterKeyRotation/web] Melebihi batas percobaan. Semua key gagal.");
}
