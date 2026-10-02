-- Task B docs/PROMPT-CHATBOT-TOOLS-V2.md: kolom topic_label langsung di posts
-- (NULL = belum diklasifikasi), diisi via jalur cepat hashtag-mapping atau
-- fallback klasifikasi isi konten oleh worker (apps/worker/src/postTopics.ts).

ALTER TABLE posts ADD COLUMN IF NOT EXISTS topic_label text;

CREATE INDEX IF NOT EXISTS idx_posts_topic_label ON posts(topic_label);

-- mv_topic_distribution sekarang bersumber langsung dari posts.topic_label
-- (mencakup post tanpa hashtag; tiap repost event dihitung tepat sekali).
DROP MATERIALIZED VIEW IF EXISTS mv_topic_distribution;

CREATE MATERIALIZED VIEW mv_topic_distribution AS
SELECT
  p.topic_label,
  COUNT(*)::int AS repost_event_count,
  COUNT(DISTINCT p.id)::int AS unique_post_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_reposters_count
FROM repost_events re
JOIN posts p ON p.id = re.post_id
WHERE p.topic_label IS NOT NULL
GROUP BY p.topic_label;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_topic_distribution_label ON mv_topic_distribution(topic_label);
