import { prisma } from "@repostinsight/db";
import { RepostApifyService, ApifyActorItem } from "./apifyClient";

import { getNextActiveApifyKey, handleKeyError } from "./keyRotation";
import { describePost, PostForDescribe } from "./visualDescriber";

const MAX_RETRY = 3;
const LOOP_POLL_INTERVAL_MS = 5000;

export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const matches = caption.match(/#([\w\u0590-\u05ff_]+)/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((h) => h.replace(/^#/, "").toLowerCase())));
}

/**
 * Persists scraped posts and repost events into Postgres with find-or-create logic
 * (FR-4.1–4.4)
 */
export async function saveScrapedReposts(followerUsername: string, items: ApifyActorItem[]) {
  for (const item of items) {
    const postId = (item.postId || item.id || "").toString().trim();
    if (!postId) continue;

    const code = (item.shortCode || item.code || null)?.toString() || null;
    const rawAny = item as any;
    const ownerUsername =
      (rawAny.user?.username || rawAny.ownerUsername || rawAny.originalAuthor || rawAny.original_author || rawAny.owner_username || rawAny.owner?.username || null)?.toString() || null;

    let captionText: string | null = null;
    if (typeof item.caption === "string") {
      captionText = item.caption;
    } else if (typeof item.caption === "object" && item.caption !== null) {
      captionText = (item.caption as any).text || null;
    } else if (typeof item.captionText === "string") {
      captionText = item.captionText;
    } else if (typeof (item as any).text === "string") {
      captionText = (item as any).text;
    }

    const hashtags = extractHashtags(captionText);
    const mediaType = (item.postType || item.media_type || (item as any).media_format || null)?.toString() || null;
    const likeCount = typeof item.likeCount === "number" ? item.likeCount : typeof item.like_count === "number" ? item.like_count : null;
    const playCount = typeof item.playCount === "number" ? item.playCount : typeof item.play_count === "number" ? item.play_count : typeof (item as any).view_count === "number" ? (item as any).view_count : null;
    
    let takenAt: Date | null = null;
    const rawTakenAt = (item as any).takenAtDate || (item as any).taken_at_date || item.takenAt || item.taken_at;
    if (rawTakenAt) {
      if (typeof rawTakenAt === "number") {
        takenAt = new Date(rawTakenAt > 1e11 ? rawTakenAt : rawTakenAt * 1000);
      } else {
        const parsedDate = new Date(rawTakenAt);
        if (!isNaN(parsedDate.getTime())) takenAt = parsedDate;
      }
    }

    // 1. Upsert Post (find-or-create, FR-4.1–4.3)
    const isNewPost = !(await prisma.post.findUnique({ where: { id: postId }, select: { id: true } }));
    await prisma.post.upsert({
      where: { id: postId },
      create: {
        id: postId,
        code,
        ownerUsername,
        captionText,
        hashtags,
        mediaType,
        likeCount,
        playCount,
        takenAt,
        rawJson: item as object,
        embeddingStatus: "pending",
        visualDescriptionStatus: "pending",
      },
      update: {
        code: code ?? undefined,
        ownerUsername: ownerUsername ?? undefined,
        captionText: captionText ?? undefined,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        mediaType: mediaType ?? undefined,
        likeCount: likeCount ?? undefined,
        playCount: playCount ?? undefined,
        rawJson: item as object,
      },
    });

    // 2. Describe post (F10 — FR-10.3: langsung setelah find-or-create, di siklus yang sama)
    //    Hanya describe post baru atau yang belum pernah berhasil didescribe.
    const postRecord = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, mediaType: true, captionText: true, rawJson: true, visualDescriptionStatus: true },
    });

    if (postRecord && postRecord.visualDescriptionStatus !== "done") {
      const postForDescribe: PostForDescribe = {
        id: postRecord.id,
        mediaType: postRecord.mediaType,
        captionText: postRecord.captionText,
        rawJson: postRecord.rawJson as Record<string, unknown> | null,
      };

      try {
        const visualDesc = await describePost(postForDescribe);
        // FR-10.4: reset embedding_status ke pending supaya embedding worker embed ulang
        await prisma.$executeRawUnsafe(
          `UPDATE posts SET visual_description = $1, visual_description_status = 'done', embedding_status = 'pending', last_updated_at = NOW() WHERE id = $2`,
          visualDesc,
          postId
        );
        console.log(`[ScrapeLoop] Visual description berhasil untuk post ${postId} (${mediaType ?? "unknown"}).`);
      } catch (descErr: any) {
        if (descErr?.skip) {
          // Media type tidak dikenali — skip tanpa marking failed
          await prisma.$executeRawUnsafe(
            `UPDATE posts SET visual_description_status = 'skipped', last_updated_at = NOW() WHERE id = $1`,
            postId
          );
        } else {
          // FR-10.6: kegagalan total (URL expired, dll) — tandai failed, tidak retry
          console.warn(`[ScrapeLoop] Visual description GAGAL untuk post ${postId}:`, (descErr as Error).message);
          await prisma.$executeRawUnsafe(
            `UPDATE posts SET visual_description_status = 'failed', last_updated_at = NOW() WHERE id = $1`,
            postId
          );
        }
      }
    }

    // 3. Upsert RepostEvent (unique on follower_username, post_id)
    await prisma.repostEvent.upsert({
      where: {
        followerUsername_postId: {
          followerUsername,
          postId,
        },
      },
      create: {
        followerUsername,
        postId,
        scrapedAt: new Date(),
      },
      update: {
        scrapedAt: new Date(),
      },
    });
  }

  // Refresh materialized views so dashboard & chatbot see new aggregates
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_reposted_accounts;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_hashtags;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_repost_activity_timeline;`);
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_topic_distribution;`);
  } catch {
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_top_reposted_accounts;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_trending_hashtags;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_repost_activity_timeline;`);
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW mv_topic_distribution;`);
    } catch (err) {
      console.warn("[ScrapeLoop] Gagal merefresh materialized views:", err);
    }
  }
}

/**
 * Reconciles in_progress followers upon worker startup (FR-2.3)
 */
export async function reconcileInProgressFollowers(getService: () => Promise<RepostApifyService | null>) {
  console.log("[Reconcile] Memeriksa follower berstatus in_progress...");
  const inProgressFollowers = await prisma.follower.findMany({
    where: {
      status: "in_progress",
      apifyRunId: { not: null },
    },
  });

  if (inProgressFollowers.length === 0) {
    console.log("[Reconcile] Tidak ada follower in_progress yang menggantung.");
    return;
  }

  console.log(`[Reconcile] Ditemukan ${inProgressFollowers.length} follower in_progress. Melakukan rekonsiliasi...`);

  for (const follower of inProgressFollowers) {
    try {
      const apifyService = await getService();
      if (!apifyService) {
        console.warn("[Reconcile] Tidak ada API service aktif, menunda rekonsiliasi.");
        break;
      }

      const runStatus = await apifyService.getRunStatus(follower.apifyRunId!);
      console.log(`[Reconcile] @${follower.username} (runId: ${follower.apifyRunId}): Status Apify adalah ${runStatus.status}`);

      if (runStatus.status === "SUCCEEDED" && runStatus.datasetId) {
        const { validItems, errorItems } = await apifyService.getDatasetItems(runStatus.datasetId);

        // Jika seluruh item adalah error (0 valid) → perlakukan sebagai failure, retry dengan key berikutnya
        if (validItems.length === 0 && errorItems.length > 0) {
          const errSummary = errorItems.map((e) => e.error).join(", ");
          console.warn(
            `[Reconcile] @${follower.username} — semua ${errorItems.length} item adalah error (${errSummary}). Dianggap gagal, akan di-retry.`
          );
          const newRetryCount = follower.retryCount + 1;
          const newStatus = newRetryCount >= MAX_RETRY ? "failed" : "pending";
          await prisma.follower.update({
            where: { username: follower.username },
            data: {
              status: newStatus,
              retryCount: newRetryCount,
              apifyRunId: null, // reset agar tidak dimonitor lagi
            },
          });
          console.log(
            `[Reconcile] @${follower.username} -> ${newStatus} (retry: ${newRetryCount}/${MAX_RETRY})`
          );
        } else {
          if (errorItems.length > 0) {
            console.warn(
              `[Reconcile] @${follower.username} — ${errorItems.length} error item dari Apify:`,
              errorItems.map((e) => e.error).join(", ")
            );
          }
          await saveScrapedReposts(follower.username, validItems);
          await prisma.follower.update({
            where: { username: follower.username },
            data: {
              status: "done",
              lastScrapedAt: new Date(),
            },
          });
          console.log(
            `[Reconcile] @${follower.username} selesai direkonsiliasi -> done (${validItems.length} repost valid, ${errorItems.length} error).`
          );
        }
      } else if (
        runStatus.status === "FAILED" ||
        runStatus.status === "ABORTED" ||
        runStatus.status === "TIMED-OUT"
      ) {
        const newRetryCount = follower.retryCount + 1;
        const newStatus = newRetryCount >= MAX_RETRY ? "failed" : "pending";
        await prisma.follower.update({
          where: { username: follower.username },
          data: {
            status: newStatus,
            retryCount: newRetryCount,
          },
        });
        console.log(`[Reconcile] @${follower.username} run gagal (${runStatus.status}) -> ${newStatus} (retry: ${newRetryCount}/${MAX_RETRY})`);
      } else {
        // RUNNING or READY - Biarkan in_progress, akan dipantau oleh loop
        console.log(`[Reconcile] @${follower.username} masih berjalan di server Apify.`);
      }
    } catch (err) {
      console.error(`[Reconcile] Gagal merekonsiliasi @${follower.username}:`, err);
    }
  }
}

/**
 * Main scraping loop
 */
export async function startScrapeLoop(
  getService: () => Promise<RepostApifyService | null>,
  shouldStopRef: { stop: boolean }
) {
  console.log("[ScrapeLoop] Memulai worker scraping...");

  // 1. Startup reconciliation (FR-2.3)
  await reconcileInProgressFollowers(getService);

  while (!shouldStopRef.stop) {
    try {
      // 2. Check scrape control (FR-2.4, FR-2.5)
      const control = await prisma.scrapeControl.findUnique({
        where: { id: 1 },
      });

      if (control?.isPaused) {
        // Sedang dijeda oleh user atau sistem
        await new Promise((resolve) => setTimeout(resolve, LOOP_POLL_INTERVAL_MS));
        continue;
      }

      const maxConcurrency = control?.maxConcurrency || 3;

      // 3. Monitor active runs
      const activeFollowers = await prisma.follower.findMany({
        where: {
          status: "in_progress",
          apifyRunId: { not: null },
        },
      });

      const apifyService = await getService();
      if (!apifyService) {
        console.warn("[ScrapeLoop] Tidak ada Apify API Key yang aktif. Menjeda proses...");
        await prisma.scrapeControl.update({
          where: { id: 1 },
          data: { isPaused: true, pauseReason: "no_active_apify_keys" },
        });
        await new Promise((resolve) => setTimeout(resolve, LOOP_POLL_INTERVAL_MS));
        continue;
      }

      // Check status of each active run
      for (const follower of activeFollowers) {
        try {
          const runStatus = await apifyService.getRunStatus(follower.apifyRunId!);

          if (runStatus.status === "SUCCEEDED" && runStatus.datasetId) {
            const { validItems, errorItems } = await apifyService.getDatasetItems(runStatus.datasetId);

            // Jika seluruh item adalah error (0 valid) → perlakukan sebagai failure, retry dengan key berikutnya
            if (validItems.length === 0 && errorItems.length > 0) {
              const errSummary = errorItems.map((e) => e.error).join(", ");
              console.warn(
                `[ScrapeLoop] @${follower.username} — semua ${errorItems.length} item adalah error (${errSummary}). Dianggap gagal, akan di-retry dengan key berikutnya.`
              );
              const newRetryCount = follower.retryCount + 1;
              const newStatus = newRetryCount >= MAX_RETRY ? "failed" : "pending";
              await prisma.follower.update({
                where: { username: follower.username },
                data: {
                  status: newStatus,
                  retryCount: newRetryCount,
                  apifyRunId: null, // reset agar tidak dimonitor lagi
                },
              });
              console.log(
                `[ScrapeLoop] @${follower.username} -> ${newStatus} (retry: ${newRetryCount}/${MAX_RETRY})`
              );
            } else {
              if (errorItems.length > 0) {
                console.warn(
                  `[ScrapeLoop] @${follower.username} — ${errorItems.length} error item dari Apify (e.g. upstream_request_failed):`,
                  errorItems.map((e) => e.error).join(", ")
                );
              }
              await saveScrapedReposts(follower.username, validItems);
              await prisma.follower.update({
                where: { username: follower.username },
                data: {
                  status: "done",
                  lastScrapedAt: new Date(),
                },
              });
              console.log(
                `[ScrapeLoop] Selesai: @${follower.username} -> done (${validItems.length} repost valid, ${errorItems.length} error).`
              );
            }
          } else if (
            runStatus.status === "FAILED" ||
            runStatus.status === "ABORTED" ||
            runStatus.status === "TIMED-OUT"
          ) {
            const newRetryCount = follower.retryCount + 1;
            const newStatus = newRetryCount >= MAX_RETRY ? "failed" : "pending";
            await prisma.follower.update({
              where: { username: follower.username },
              data: {
                status: newStatus,
                retryCount: newRetryCount,
              },
            });
            console.log(`[ScrapeLoop] Run gagal untuk @${follower.username} -> status: ${newStatus}, retry: ${newRetryCount}/${MAX_RETRY}`);
          }
        } catch (checkErr) {
          console.error(`[ScrapeLoop] Gagal mengecek status run @${follower.username}:`, checkErr);
        }
      }

      // 4. Calculate available concurrency slots
      const currentInProgressCount = await prisma.follower.count({
        where: { status: "in_progress" },
      });

      const availableSlots = maxConcurrency - currentInProgressCount;

      if (availableSlots > 0) {
        // Ambil batch follower pending terlama
        const pendingFollowers = await prisma.follower.findMany({
          where: { status: "pending" },
          take: availableSlots,
          orderBy: [{ retryCount: "asc" }, { createdAt: "asc" }],
        });

        for (const follower of pendingFollowers) {
          const keyInfo = await getNextActiveApifyKey();
          if (!keyInfo) {
            console.warn("[ScrapeLoop] Tidak ada API Key yang dapat digunakan untuk dispatch. Menunda batch...");
            break;
          }

          try {
            console.log(`[ScrapeLoop] Memulai dispatch scraping untuk @${follower.username} (Key #${keyInfo.keyId})...`);
            const run = await keyInfo.service.startScrapeRun(follower.username);

            await prisma.follower.update({
              where: { username: follower.username },
              data: {
                status: "in_progress",
                apifyRunId: run.runId,
              },
            });

            console.log(`[ScrapeLoop] Dispatched @${follower.username}, Run ID: ${run.runId}`);
          } catch (dispatchErr: unknown) {
            console.error(`[ScrapeLoop] Gagal dispatch run untuk @${follower.username}:`, dispatchErr);
            const { rotated, isPaymentRequired } = await handleKeyError(keyInfo.keyId, dispatchErr);

            if (rotated && isPaymentRequired) {
              // FR-3.4: Segera coba ulang follower ini dengan key aktif berikutnya
              console.log(`[ScrapeLoop] Mencoba ulang @${follower.username} dengan key alternatif...`);
              const altKey = await getNextActiveApifyKey();
              if (altKey) {
                try {
                  const altRun = await altKey.service.startScrapeRun(follower.username);
                  await prisma.follower.update({
                    where: { username: follower.username },
                    data: {
                      status: "in_progress",
                      apifyRunId: altRun.runId,
                    },
                  });
                  console.log(`[ScrapeLoop] Sukses retry dengan Key #${altKey.keyId} untuk @${follower.username}`);
                  continue;
                } catch (altErr) {
                  await handleKeyError(altKey.keyId, altErr);
                }
              }
            }
          }
        }
      }
    } catch (loopErr) {
      console.error("[ScrapeLoop] Kesalahan tidak terduga pada siklus scraping:", loopErr);
    }

    await new Promise((resolve) => setTimeout(resolve, LOOP_POLL_INTERVAL_MS));
  }

  console.log("[ScrapeLoop] Scraping loop telah dihentikan.");
}
