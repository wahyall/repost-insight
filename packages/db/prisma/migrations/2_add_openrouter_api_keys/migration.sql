-- Migration: 2_add_openrouter_api_keys
-- Menambah tabel openrouter_api_keys untuk round-robin key rotation
-- Mirip dengan apify_api_keys (FR-3 equivalent untuk OpenRouter)

CREATE TABLE "openrouter_api_keys" (
    "id"                  SERIAL PRIMARY KEY,
    "label"               TEXT,
    "token"               TEXT NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'active', -- active/rate_limited/invalid
    "rate_limited_until"  TIMESTAMP(3),
    "last_checked_at"     TIMESTAMP(3),
    "last_used_at"        TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
