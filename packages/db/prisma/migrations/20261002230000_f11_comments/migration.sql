-- AlterTable posts
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "comment_count" INTEGER;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "comments_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "comment_summary" TEXT;

-- CreateTable comments
CREATE TABLE IF NOT EXISTS "comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "commenter_username" TEXT,
    "text" TEXT,
    "like_count" INTEGER,
    "is_ranked_comment" BOOLEAN,
    "child_comment_count" INTEGER,
    "commented_at" TIMESTAMP(3) WITH TIME ZONE,
    "scraped_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_comments_post_id" ON "comments"("post_id");
CREATE INDEX IF NOT EXISTS "idx_comments_like_count" ON "comments"("like_count");
CREATE INDEX IF NOT EXISTS "posts_comments_status_idx" ON "posts"("comments_status");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'comments_post_id_fkey'
    ) THEN
        ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill comment_count from raw_json where available
UPDATE "posts"
SET "comment_count" = COALESCE(
  ("raw_json"->>'comment_count')::int,
  ("raw_json"->>'commentsCount')::int,
  ("raw_json"->>'comments_count')::int,
  ("raw_json"->>'commentCount')::int
)
WHERE "raw_json" IS NOT NULL
  AND "comment_count" IS NULL
  AND (
    "raw_json"->>'comment_count' IS NOT NULL OR
    "raw_json"->>'commentsCount' IS NOT NULL OR
    "raw_json"->>'comments_count' IS NOT NULL OR
    "raw_json"->>'commentCount' IS NOT NULL
  );

-- Auto-skip posts with 0 comments (FR-11.2) or where comments are disabled
UPDATE "posts"
SET "comments_status" = 'skipped'
WHERE "comments_status" = 'pending'
  AND (
    "comment_count" = 0 OR
    ("raw_json"->>'comments_disabled')::boolean = true
  );
