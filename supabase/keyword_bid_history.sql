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

-- RLS — table had RLS enabled with NO policies (logged-in users read nothing → keyword/target
-- names fell back to IDs on the Changes page). Added 2026-06-30.
ALTER TABLE public.keyword_bid_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all_keyword_bid_history ON public.keyword_bid_history;
CREATE POLICY service_all_keyword_bid_history ON public.keyword_bid_history FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS keyword_bid_history_own ON public.keyword_bid_history;
CREATE POLICY keyword_bid_history_own ON public.keyword_bid_history FOR ALL TO public USING (profile_id IN (SELECT my_profile_ids()));
