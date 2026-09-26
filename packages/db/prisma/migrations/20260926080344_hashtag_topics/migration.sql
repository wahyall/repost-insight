-- CreateTable
CREATE TABLE "hashtag_topics" (
    "hashtag" TEXT NOT NULL,
    "topic_label" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hashtag_topics_pkey" PRIMARY KEY ("hashtag")
);

-- CreateIndex
CREATE INDEX "hashtag_topics_topic_label_idx" ON "hashtag_topics"("topic_label");

-- Materialized View: Topic Distribution (kelompok semantik dari hashtag, lihat hashtag_topics)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_topic_distribution AS
SELECT
  ht.topic_label,
  COUNT(*)::int AS usage_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_reposters_count,
  COUNT(DISTINCT p.id)::int AS unique_post_count
FROM posts p
CROSS JOIN LATERAL unnest(p.hashtags) AS tag
JOIN hashtag_topics ht ON ht.hashtag = tag
JOIN repost_events re ON re.post_id = p.id
GROUP BY ht.topic_label
ORDER BY usage_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_topic_distribution_label ON mv_topic_distribution(topic_label);
