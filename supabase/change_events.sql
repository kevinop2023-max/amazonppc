-- ============================================================================
-- change_events — unified change-history log (Redesign v2)
-- Sources:
--   'api'      = Amazon Change History API (POST /history) — ACTIVE, sole source
--                since 2026-07-01 (fix: request needs parents:[{useProfileIdAdvertiser:true}]).
--                Ingested by sync-profile.syncChangeHistory(). See D-017.
--   'snapshot' = snapshot-diff fallback — RETIRED 2026-07-02. Its dates were
--                sync-window artifacts; rows deleted except 3 pre-API-window events
--                (Mar 2026, older than the API's hard 90-day lookback). Cron job 6
--                unscheduled; sync-poll/sync-profile calls commented out. The
--                diff_snapshots_to_change_events() function below is kept in the DB
--                unused — re-enable only if the API breaks.
-- IDs are TEXT (Change History API may return alphanumeric IDs).
--
-- Captured fields (snapshot source):
--   KEYWORD.BID_AMOUNT            ← keyword_bid_history (backfilled)
--   CAMPAIGN.BUDGET_AMOUNT/STATUS ← sp/sb/sd_campaigns daily rows (backfilled)
--   CAMPAIGN.SMART_BIDDING_STRATEGY, PLACEMENT_TOP/PLACEMENT_PRODUCT_PAGE/PLACEMENT_REST_OF_SEARCH
--                                 ← sp_campaigns.bidding_strategy + placement_*_pct (forward-only from 2026-06-29)
--   AD_GROUP.DEFAULT_BID_AMOUNT   ← sp_ad_groups.default_bid_cents (forward-only)
-- Supporting capture columns added by this migration:
--   ALTER TABLE sp_campaigns ADD COLUMN bidding_strategy TEXT, placement_top_pct NUMERIC,
--                                       placement_product_pct NUMERIC, placement_rest_pct NUMERIC;
--   ALTER TABLE sp_ad_groups ADD CONSTRAINT uq_sp_ad_groups UNIQUE (profile_id, ad_group_id, date);
--   (sp_ad_groups is now populated daily by sync-profile.syncCampaignStates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.change_events (
  id            BIGSERIAL PRIMARY KEY,
  profile_id    BIGINT NOT NULL,
  ad_type       TEXT,                       -- 'SP' | 'SB' | 'SD'
  entity_type   TEXT NOT NULL,              -- CAMPAIGN | AD_GROUP | KEYWORD | PRODUCT_TARGETING | NEGATIVE_KEYWORD | AD
  entity_id     TEXT NOT NULL,
  campaign_id   TEXT,
  ad_group_id   TEXT,
  field         TEXT NOT NULL,              -- BID_AMOUNT | BUDGET_AMOUNT | DEFAULT_BID_AMOUNT | STATUS | IN_BUDGET
                                            --  | PLACEMENT_TOP | PLACEMENT_PRODUCT_PAGE | PLACEMENT_REST_OF_SEARCH
                                            --  | SMART_BIDDING_STRATEGY | NAME | START_DATE | END_DATE | PORTFOLIO
  old_value     NUMERIC,                    -- cents for amounts, percent for placements
  new_value     NUMERIC,
  old_text      TEXT,                       -- raw / status / strategy / name
  new_text      TEXT,
  event_ts      TIMESTAMPTZ NOT NULL,       -- real edit time (API) or snapshot date 00:00 (snapshot)
  metadata      JSONB,
  source        TEXT NOT NULL DEFAULT 'api',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_change_events UNIQUE (profile_id, entity_type, entity_id, field, event_ts)
);

CREATE INDEX IF NOT EXISTS idx_change_events_entity   ON public.change_events (profile_id, entity_type, entity_id, field);
CREATE INDEX IF NOT EXISTS idx_change_events_field_ts ON public.change_events (profile_id, field, event_ts);
CREATE INDEX IF NOT EXISTS idx_change_events_campaign ON public.change_events (profile_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_change_events_ts       ON public.change_events (profile_id, event_ts);

ALTER TABLE public.change_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all_change_events ON public.change_events;
CREATE POLICY service_all_change_events ON public.change_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS change_events_own ON public.change_events;
CREATE POLICY change_events_own ON public.change_events FOR ALL TO public USING (profile_id IN (SELECT my_profile_ids()));

-- ── Snapshot-diff engine ────────────────────────────────────────────────────
-- Diffs existing daily snapshots into change_events. Idempotent. Returns # inserted.
-- Scheduled: pg_cron 'diff-change-events-daily' @ 07:00 UTC + called at end of sync-poll.
-- Rule for every block: emit only when the previous (lag) value IS NOT NULL and DISTINCT
-- from current. For new capture fields (strategy/placement/default-bid) this skips the
-- one-time historical-NULL → first-captured transition (no false positives on deploy day).
CREATE OR REPLACE FUNCTION public.diff_snapshots_to_change_events(p_profile bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  inserted integer := 0;
  n integer;
BEGIN
  -- KEYWORD / PRODUCT_TARGETING bids (keyword_bid_history). Classify by match_type:
  -- targeting_expression / targeting_expression_predefined = product/auto targets.
  WITH ordered AS (
    SELECT profile_id, keyword_id, ad_type, campaign_id, match_type, bid_cents, recorded_date,
           lag(bid_cents) OVER (PARTITION BY profile_id, keyword_id ORDER BY recorded_date) AS prev_bid
    FROM public.keyword_bid_history
    WHERE (p_profile IS NULL OR profile_id = p_profile)
  )
  INSERT INTO public.change_events
    (profile_id, ad_type, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, source)
  SELECT profile_id, upper(coalesce(ad_type,'SP')),
         CASE WHEN lower(coalesce(match_type,'')) IN ('targeting_expression','targeting_expression_predefined')
              THEN 'PRODUCT_TARGETING' ELSE 'KEYWORD' END,
         keyword_id::text, campaign_id::text, 'BID_AMOUNT',
         prev_bid, bid_cents, prev_bid::text, bid_cents::text, recorded_date::timestamptz, 'snapshot'
  FROM ordered
  WHERE prev_bid IS NOT NULL AND prev_bid IS DISTINCT FROM bid_cents AND prev_bid > 0 AND bid_cents > 0
  ON CONFLICT (profile_id, entity_type, entity_id, field, event_ts) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  -- CAMPAIGN budget (SP/SB/SD daily snapshot rows)
  WITH allc AS (
    SELECT 'SP' AS adt, profile_id, campaign_id, date, daily_budget_cents FROM public.sp_campaigns
    UNION ALL SELECT 'SB', profile_id, campaign_id, date, daily_budget_cents FROM public.sb_campaigns
    UNION ALL SELECT 'SD', profile_id, campaign_id, date, daily_budget_cents FROM public.sd_campaigns
  ), ordered AS (
    SELECT adt, profile_id, campaign_id, date, daily_budget_cents,
           lag(daily_budget_cents) OVER (PARTITION BY adt, profile_id, campaign_id ORDER BY date) AS prev_budget
    FROM allc WHERE (p_profile IS NULL OR profile_id = p_profile)
  )
  INSERT INTO public.change_events
    (profile_id, ad_type, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, source)
  SELECT profile_id, adt, 'CAMPAIGN', campaign_id::text, campaign_id::text, 'BUDGET_AMOUNT',
         prev_budget, daily_budget_cents, prev_budget::text, daily_budget_cents::text, date::timestamptz, 'snapshot'
  FROM ordered
  WHERE prev_budget IS NOT NULL AND prev_budget IS DISTINCT FROM daily_budget_cents AND prev_budget > 0 AND daily_budget_cents > 0
  ON CONFLICT (profile_id, entity_type, entity_id, field, event_ts) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  -- CAMPAIGN status (lower-cased to avoid ENABLED/enabled false positives)
  WITH allc AS (
    SELECT 'SP' AS adt, profile_id, campaign_id, date, lower(state) AS st FROM public.sp_campaigns
    UNION ALL SELECT 'SB', profile_id, campaign_id, date, lower(state) FROM public.sb_campaigns
    UNION ALL SELECT 'SD', profile_id, campaign_id, date, lower(state) FROM public.sd_campaigns
  ), ordered AS (
    SELECT adt, profile_id, campaign_id, date, st,
           lag(st) OVER (PARTITION BY adt, profile_id, campaign_id ORDER BY date) AS prev_state
    FROM allc WHERE (p_profile IS NULL OR profile_id = p_profile)
  )
  INSERT INTO public.change_events
    (profile_id, ad_type, entity_type, entity_id, campaign_id, field, old_text, new_text, event_ts, source)
  SELECT profile_id, adt, 'CAMPAIGN', campaign_id::text, campaign_id::text, 'STATUS',
         prev_state, st, date::timestamptz, 'snapshot'
  FROM ordered
  WHERE prev_state IS NOT NULL AND prev_state IS DISTINCT FROM st AND prev_state <> '' AND st <> ''
  ON CONFLICT (profile_id, entity_type, entity_id, field, event_ts) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  -- CAMPAIGN bidding strategy (SP only)
  WITH ordered AS (
    SELECT profile_id, campaign_id, date, bidding_strategy AS strat,
           lag(bidding_strategy) OVER (PARTITION BY profile_id, campaign_id ORDER BY date) AS prev_strat
    FROM public.sp_campaigns WHERE (p_profile IS NULL OR profile_id = p_profile)
  )
  INSERT INTO public.change_events
    (profile_id, ad_type, entity_type, entity_id, campaign_id, field, old_text, new_text, event_ts, source)
  SELECT profile_id, 'SP', 'CAMPAIGN', campaign_id::text, campaign_id::text, 'SMART_BIDDING_STRATEGY',
         prev_strat, strat, date::timestamptz, 'snapshot'
  FROM ordered
  WHERE prev_strat IS NOT NULL AND strat IS NOT NULL AND prev_strat IS DISTINCT FROM strat
  ON CONFLICT (profile_id, entity_type, entity_id, field, event_ts) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  -- CAMPAIGN placement multipliers (SP only — 3 placements, percent; 0 = no adjustment)
  WITH ordered AS (
    SELECT profile_id, campaign_id, date,
           placement_top_pct AS top, placement_product_pct AS prod, placement_rest_pct AS rest,
           lag(placement_top_pct)     OVER w AS p_top,
           lag(placement_product_pct) OVER w AS p_prod,
           lag(placement_rest_pct)    OVER w AS p_rest
    FROM public.sp_campaigns WHERE (p_profile IS NULL OR profile_id = p_profile)
    WINDOW w AS (PARTITION BY profile_id, campaign_id ORDER BY date)
  ), placements AS (
    SELECT profile_id, campaign_id, date, 'PLACEMENT_TOP' AS field, p_top AS prev_v, top AS new_v FROM ordered
    UNION ALL SELECT profile_id, campaign_id, date, 'PLACEMENT_PRODUCT_PAGE', p_prod, prod FROM ordered
    UNION ALL SELECT profile_id, campaign_id, date, 'PLACEMENT_REST_OF_SEARCH', p_rest, rest FROM ordered
  )
  INSERT INTO public.change_events
    (profile_id, ad_type, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, source)
  SELECT profile_id, 'SP', 'CAMPAIGN', campaign_id::text, campaign_id::text, field,
         prev_v, new_v, prev_v::text, new_v::text, date::timestamptz, 'snapshot'
  FROM placements
  WHERE prev_v IS NOT NULL AND new_v IS NOT NULL AND prev_v IS DISTINCT FROM new_v
  ON CONFLICT (profile_id, entity_type, entity_id, field, event_ts) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  -- AD GROUP default bid (sp_ad_groups daily snapshots)
  WITH ordered AS (
    SELECT profile_id, ad_group_id, campaign_id, date, default_bid_cents AS bid,
           lag(default_bid_cents) OVER (PARTITION BY profile_id, ad_group_id ORDER BY date) AS prev_bid
    FROM public.sp_ad_groups WHERE (p_profile IS NULL OR profile_id = p_profile)
  )
  INSERT INTO public.change_events
    (profile_id, ad_type, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, source)
  SELECT profile_id, 'SP', 'AD_GROUP', ad_group_id::text, campaign_id::text, 'DEFAULT_BID_AMOUNT',
         prev_bid, bid, prev_bid::text, bid::text, date::timestamptz, 'snapshot'
  FROM ordered
  WHERE prev_bid IS NOT NULL AND prev_bid IS DISTINCT FROM bid AND prev_bid > 0 AND bid > 0
  ON CONFLICT (profile_id, entity_type, entity_id, field, event_ts) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  RETURN inserted;
END
$fn$;

-- Scheduling (run once):
-- SELECT cron.schedule('diff-change-events-daily', '0 7 * * *', 'SELECT public.diff_snapshots_to_change_events(NULL)');
