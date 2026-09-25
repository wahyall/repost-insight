import { prisma } from "@repostinsight/db";

/**
 * Menunggu hingga key rate_limited yang paling cepat aktif kembali.
 * Dipakai saat semua key sedang rate_limited agar tidak langsung throw.
 * Mengembalikan jumlah ms yang ditunggu, atau 0 jika tidak ada key rate_limited.
 */
async function waitForEarliestKeyReactivation(): Promise<number> {
  const soonest = await prisma.openRouterApiKey.findFirst({
    where: { status: "rate_limited", rateLimitedUntil: { not: null } },
    orderBy: { rateLimitedUntil: "asc" },
  });

  if (!soonest?.rateLimitedUntil) return 0;

  const waitMs = Math.max(0, soonest.rateLimitedUntil.getTime() - Date.now()) + 500; // +500ms buffer
  console.warn(
    `[OpenRouterKeyRotation] Semua key sedang rate limited. Menunggu ${Math.ceil(waitMs / 1000)}s hingga key #${soonest.id} aktif kembali...`
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return waitMs;
}

/**
 * Mengembalikan key OpenRouter berikutnya yang aktif (round-robin: LRU order).
 * - Jika ada key di DB dengan status 'active', pakai yang paling lama tidak dipakai.
 * - Jika semua key di DB rate_limited, kembalikan null.
 * - Jika tidak ada key di DB sama sekali, fallback ke env OPENROUTER_API_KEY.
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

  // 2. Find least-recently-used active key
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

  // 3. Fallback: use env var if no DB keys exist at all
  const totalKeys = await prisma.openRouterApiKey.count();
  if (totalKeys === 0 && process.env.OPENROUTER_API_KEY) {
    return { token: process.env.OPENROUTER_API_KEY, keyId: 0 };
  }

  return null;
}

/**
 * Menandai key sebagai rate_limited ketika menerima HTTP 429.
 * Key akan otomatis diaktifkan kembali setelah `retryAfterSeconds`.
 */
export async function markOpenRouterKeyRateLimited(
  keyId: number,
  retryAfterSeconds: number = 60
): Promise<void> {
  if (keyId === 0) {
    // env fallback key — tidak bisa disimpan ke DB, cukup log
    console.warn(`[OpenRouterKeyRotation] Key env-fallback kena rate limit. Tunggu ${retryAfterSeconds}s.`);
    return;
  }

  const rateLimitedUntil = new Date(Date.now() + retryAfterSeconds * 1000);
  await prisma.openRouterApiKey.update({
    where: { id: keyId },
    data: {
      status: "rate_limited",
      rateLimitedUntil,
      lastCheckedAt: new Date(),
    },
  });
  console.warn(
    `[OpenRouterKeyRotation] Key #${keyId} rate limited. Aktif kembali pada: ${rateLimitedUntil.toISOString()}`
  );
}

/**
 * Menandai key sebagai invalid ketika menerima HTTP 401/403.
 */
export async function markOpenRouterKeyInvalid(keyId: number): Promise<void> {
  if (keyId === 0) {
    console.warn("[OpenRouterKeyRotation] Key env-fallback dikembalikan sebagai invalid (401/403).");
    return;
  }

  await prisma.openRouterApiKey.update({
    where: { id: keyId },
    data: {
      status: "invalid",
      lastCheckedAt: new Date(),
    },
  });
  console.warn(`[OpenRouterKeyRotation] Key #${keyId} ditandai invalid (401/403).`);
}

/**
 * Wrapper fetch ke OpenRouter dengan otomatis round-robin + retry ke key berikutnya jika 429.
 * Coba hingga semua key aktif habis dicoba.
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
      // Cek apakah ada key yang rate_limited (bukan invalid/tidak ada sama sekali)
      const rateLimitedCount = await prisma.openRouterApiKey.count({
        where: { status: "rate_limited" },
      });

      if (rateLimitedCount > 0) {
        // Tunggu key paling cepat aktif, lalu retry loop (tidak consume attempt)
        await waitForEarliestKeyReactivation();
        triedKeyIds.clear();
        attempt--; // jangan hitung sebagai percobaan
        continue;
      }

      throw new Error(
        "[OpenRouterKeyRotation] Tidak ada OpenRouter API Key yang aktif. Tambahkan key di tabel openrouter_api_keys atau set OPENROUTER_API_KEY."
      );
    }

    // Jika semua key sudah dicoba pada putaran ini
    if (triedKeyIds.has(keyInfo.keyId)) {
      const rateLimitedCount = await prisma.openRouterApiKey.count({
        where: { status: "rate_limited" },
      });
      if (rateLimitedCount > 0) {
        await waitForEarliestKeyReactivation();
        triedKeyIds.clear();
        attempt--;
        continue;
      }
      throw new Error("[OpenRouterKeyRotation] Semua key aktif sudah dicoba dan terkena rate limit.");
    }
    triedKeyIds.add(keyInfo.keyId);

    // Inject Authorization header dengan key saat ini
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
        `[OpenRouterKeyRotation] Key #${keyInfo.keyId} kena rate limit (429). Retry-After: ${retrySecSafe}s. Rotasi ke key berikutnya...`
      );
      if (keyInfo.keyId === 0) {
        await new Promise((r) => setTimeout(r, Math.min(retrySecSafe, 60) * 1000));
        triedKeyIds.clear();
      } else {
        await markOpenRouterKeyRateLimited(keyInfo.keyId, retrySecSafe);
      }
      continue; // coba key berikutnya
    }

    if (res.status === 401 || res.status === 403) {
      console.warn(`[OpenRouterKeyRotation] Key #${keyInfo.keyId} invalid (${res.status}). Rotasi ke key berikutnya...`);
      await markOpenRouterKeyInvalid(keyInfo.keyId);
      continue; // coba key berikutnya
    }

    return res;
  }

  throw new Error("[OpenRouterKeyRotation] Melebihi batas percobaan (maxAttempts). Semua key gagal.");
}
