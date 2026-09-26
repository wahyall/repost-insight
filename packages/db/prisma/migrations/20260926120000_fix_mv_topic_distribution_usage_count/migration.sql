-- Perbaikan: usage_count sebelumnya memakai COUNT(*) sehingga satu post dengan
-- beberapa hashtag yang memetakan ke topik yang sama dihitung berkali-kali
-- (post x hashtag x repost_event). Diganti COUNT(DISTINCT re.id) agar setiap
-- repost event hanya dihitung sekali per topik.
DROP MATERIALIZED VIEW IF EXISTS mv_topic_distribution;

CREATE MATERIALIZED VIEW mv_topic_distribution AS
SELECT
  ht.topic_label,
  COUNT(DISTINCT re.id)::int AS usage_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_reposters_count,
  COUNT(DISTINCT p.id)::int AS unique_post_count
FROM posts p
CROSS JOIN LATERAL unnest(p.hashtags) AS tag
JOIN hashtag_topics ht ON ht.hashtag = tag
JOIN repost_events re ON re.post_id = p.id
GROUP BY ht.topic_label
ORDER BY usage_count DESC;

CREATE UNIQUE INDEX idx_mv_topic_distribution_label ON mv_topic_distribution(topic_label);
