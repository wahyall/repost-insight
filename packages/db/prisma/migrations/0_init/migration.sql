-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Follower table
CREATE TABLE IF NOT EXISTS "followers" (
    "username" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "apify_run_id" TEXT,
    "last_scraped_at" TIMESTAMP(3) WITH TIME ZONE,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followers_pkey" PRIMARY KEY ("username")
);

-- Posts table
CREATE TABLE IF NOT EXISTS "posts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "owner_username" TEXT,
    "caption_text" TEXT,
    "hashtags" TEXT[],
    "media_type" TEXT,
    "like_count" INTEGER,
    "play_count" INTEGER,
    "taken_at" TIMESTAMP(3) WITH TIME ZONE,
    "raw_json" JSONB,
    "embedding_status" TEXT NOT NULL DEFAULT 'pending',
    "first_seen_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1024),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- Repost events table
CREATE TABLE IF NOT EXISTS "repost_events" (
    "id" SERIAL NOT NULL,
    "follower_username" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "scraped_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repost_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "repost_events_follower_username_fkey" FOREIGN KEY ("follower_username") REFERENCES "followers"("username") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "repost_events_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Apify API Keys table
CREATE TABLE IF NOT EXISTS "apify_api_keys" (
    "id" SERIAL NOT NULL,
    "label" TEXT,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "monthly_usage_usd" DECIMAL(65,30),
    "max_monthly_usage_usd" DECIMAL(65,30),
    "usage_cycle_ends_at" TIMESTAMP(3) WITH TIME ZONE,
    "last_checked_at" TIMESTAMP(3) WITH TIME ZONE,
    "last_used_at" TIMESTAMP(3) WITH TIME ZONE,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apify_api_keys_pkey" PRIMARY KEY ("id")
);

-- Scrape Control table
CREATE TABLE IF NOT EXISTS "scrape_control" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "pause_reason" TEXT,
    "max_concurrency" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "scrape_control_pkey" PRIMARY KEY ("id")
);

-- Chat Messages table
CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" SERIAL NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- Create unique index & foreign key indices
CREATE UNIQUE INDEX IF NOT EXISTS "repost_events_follower_username_post_id_key" ON "repost_events"("follower_username", "post_id");
CREATE INDEX IF NOT EXISTS "repost_events_post_id_idx" ON "repost_events"("post_id");
CREATE INDEX IF NOT EXISTS "repost_events_follower_username_idx" ON "repost_events"("follower_username");
CREATE INDEX IF NOT EXISTS "followers_status_idx" ON "followers"("status");
CREATE INDEX IF NOT EXISTS "posts_embedding_status_idx" ON "posts"("embedding_status");

-- Seed scrape_control row if not exists
INSERT INTO "scrape_control" ("id", "is_paused", "max_concurrency")
VALUES (1, false, 3)
ON CONFLICT ("id") DO NOTHING;
