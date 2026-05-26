-- Keyword bid history: one row per keyword per sync day
-- Captures the current bid each time sync-poll runs, building a real change history.

CREATE TABLE IF NOT EXISTS keyword_bid_history (
  id            bigserial PRIMARY KEY,
  profile_id    bigint    NOT NULL,
  keyword_id    bigint    NOT NULL,
  ad_type       text      NOT NULL DEFAULT 'sp',   -- 'sp' | 'sb'
  keyword_text  text      NOT NULL DEFAULT '',
  match_type    text      NOT NULL DEFAULT 'broad',
  campaign_id   bigint    NOT NULL,
  bid_cents     int       NOT NULL,
  recorded_date date      NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (profile_id, keyword_id, ad_type, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_kbh_profile_kw
  ON keyword_bid_history (profile_id, keyword_id, ad_type, recorded_date DESC);
