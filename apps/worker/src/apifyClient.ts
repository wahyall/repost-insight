import { ApifyClient } from "apify-client";

export interface ApifyRunResult {
  runId: string;
  status: string;
  datasetId?: string;
  exitCode?: number;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface ApifyActorItem {
  id?: string;
  postId?: string;
  shortCode?: string;
  code?: string;
  repostedBy?: string;
  originalAuthor?: string;
  original_author?: string;
  caption?: string;
  likeCount?: number;
  like_count?: number;
  playCount?: number;
  play_count?: number;
  commentCount?: number;
  comment_count?: number;
  postType?: string;
  media_type?: string;
  takenAt?: string;
  taken_at?: string;
  scrapedAt?: string;
  [key: string]: unknown;
}

export interface ApifyLimits {
  currentMonthlyUsageUsd?: number;
  maxMonthlyUsageUsd?: number;
  cycleEndAt?: Date;
}

export class RepostApifyService {
  private client: ApifyClient;
  private token: string;
  private actorId: string;

  constructor(token: string, actorId: string = process.env.APIFY_ACTOR_ID || "data-slayer~instagram-reposts") {
    this.token = token;
    this.actorId = actorId;
    this.client = new ApifyClient({ token });
  }

  getToken(): string {
    return this.token;
  }

  /**
   * Dispatch a new scrape run for a single Instagram follower
   * Per SRS §5: Body: { username: follower }, maxItems: 20
   */
  async startScrapeRun(followerUsername: string, maxResults: number = 20): Promise<ApifyRunResult> {
    try {
      const run = await this.client.actor(this.actorId).start(
        {
          username: followerUsername,
          maxResults,
          max_results: maxResults,
        },
        {
          maxItems: maxResults,
        }
      );

      return {
        runId: run.id,
        status: run.status,
        datasetId: run.defaultDatasetId,
        startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : undefined,
      };
    } catch (err: unknown) {
      // Re-throw with status if available (e.g. 402 Payment Required, 401 Unauthorized)
      throw err;
    }
  }

  /**
   * Check current status of an actor run (used for startup reconciliation & monitoring)
   */
  async getRunStatus(runId: string): Promise<ApifyRunResult> {
    const run = await this.client.run(runId).get();
    if (!run) {
      throw new Error(`Run ID ${runId} tidak ditemukan di Apify.`);
    }

    return {
      runId: run.id,
      status: run.status,
      datasetId: run.defaultDatasetId,
      exitCode: run.exitCode,
      startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
      finishedAt: run.finishedAt ? new Date(run.finishedAt) : undefined,
    };
  }

  /**
   * Fetch scraped dataset items once run is SUCCEEDED
   */
  async getDatasetItems(datasetId: string): Promise<ApifyActorItem[]> {
    const dataset = await this.client.dataset(datasetId).listItems({
      limit: 100,
    });

    return dataset.items as ApifyActorItem[];
  }

  /**
   * Check account limits & usage cycle (for proactive key rotation - FR-3.2)
   */
  async checkAccountLimits(): Promise<ApifyLimits> {
    // Apify client user().get() or direct HTTP fetch to /v2/users/me/limits
    try {
      const res = await fetch("https://api.apify.com/v2/users/me/limits", {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal mengambil limit Apify`);
      }

      const data = await res.json();
      const current = data.data?.current?.monthlyUsageUsd;
      const max = data.data?.limits?.maxMonthlyUsageUsd;
      const endAt = data.data?.monthlyUsageCycle?.endAt;

      return {
        currentMonthlyUsageUsd: typeof current === "number" ? current : undefined,
        maxMonthlyUsageUsd: typeof max === "number" ? max : undefined,
        cycleEndAt: endAt ? new Date(endAt) : undefined,
      };
    } catch (err) {
      console.warn(`[ApifyClient] Gagal mengecek limit token:`, err);
      return {};
    }
  }
}
