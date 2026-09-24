-- Materialized View 1: Top Reposted Accounts
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_reposted_accounts AS
SELECT 
  p.owner_username,
  COUNT(re.id)::int AS repost_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_followers_count,
  COALESCE(SUM(p.like_count), 0)::bigint AS total_likes,
  COALESCE(SUM(p.play_count), 0)::bigint AS total_plays
FROM repost_events re
JOIN posts p ON re.post_id = p.id
WHERE p.owner_username IS NOT NULL AND p.owner_username != ''
GROUP BY p.owner_username
ORDER BY repost_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_top_accounts_username ON mv_top_reposted_accounts(owner_username);

-- Materialized View 2: Trending Hashtags
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trending_hashtags AS
SELECT 
  tag,
  COUNT(*)::int AS usage_count,
  COUNT(DISTINCT re.follower_username)::int AS unique_reposters_count
FROM posts p
CROSS JOIN LATERAL unnest(p.hashtags) AS tag
JOIN repost_events re ON re.post_id = p.id
WHERE tag IS NOT NULL AND tag != ''
GROUP BY tag
ORDER BY usage_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trending_hashtags_tag ON mv_trending_hashtags(tag);

-- Materialized View 3: Repost Activity Timeline
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_repost_activity_timeline AS
SELECT 
  DATE_TRUNC('day', re.scraped_at)::date AS activity_date,
  COUNT(re.id)::int AS repost_count,
  COUNT(DISTINCT re.follower_username)::int AS active_followers_count
FROM repost_events re
GROUP BY activity_date
ORDER BY activity_date ASC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_timeline_date ON mv_repost_activity_timeline(activity_date);
