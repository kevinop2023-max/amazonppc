-- ============================================================
-- Amazon PPC Analytics Platform - Supabase Schema v1.0
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  plan            VARCHAR(50)  NOT NULL DEFAULT 'free',  -- free | pro | agency
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  settings        JSONB        NOT NULL DEFAULT '{}'     -- acos_target, timezone, alert thresholds
);

-- Auto-create user row when someone signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. AMAZON PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.amazon_profiles (
  profile_id          BIGINT       PRIMARY KEY,          -- Amazon Advertising profile ID
  user_id             UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  marketplace         VARCHAR(50)  NOT NULL,             -- e.g. ATVPDKIKX0DER (US)
  account_name        VARCHAR(255),
  timezone            VARCHAR(50)  NOT NULL DEFAULT 'America/Los_Angeles',
  access_token_enc    TEXT         NOT NULL DEFAULT '',  -- AES-256 encrypted access token
  refresh_token_enc   TEXT         NOT NULL DEFAULT '',  -- AES-256 encrypted refresh token
  token_expires_at    TIMESTAMPTZ,
  last_sync_at        TIMESTAMPTZ,
  sync_enabled        BOOLEAN      NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amazon_profiles_user_id ON public.amazon_profiles(user_id);

-- ============================================================
-- 3. PORTFOLIOS (daily snapshot)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.portfolios (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  portfolio_id        BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  portfolio_name      VARCHAR(255) NOT NULL,
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  budget_cents        INTEGER,                           -- daily budget cap in cents
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, portfolio_id, date)
);

CREATE INDEX IF NOT EXISTS idx_portfolios_profile_date ON public.portfolios(profile_id, date DESC);

-- ============================================================
-- 4. SP_CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sp_campaigns (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  campaign_id         BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  campaign_name       VARCHAR(255) NOT NULL,
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  daily_budget_cents  INTEGER,
  bidding_strategy    VARCHAR(100),
  portfolio_id        BIGINT,
  targeting_type      VARCHAR(50),                       -- manual | auto
  impressions         INTEGER      NOT NULL DEFAULT 0,
  clicks              INTEGER      NOT NULL DEFAULT 0,
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  sales_cents         INTEGER      NOT NULL DEFAULT 0,
  orders              INTEGER      NOT NULL DEFAULT 0,
  units               INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sp_campaigns_profile_date    ON public.sp_campaigns(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sp_campaigns_campaign_id     ON public.sp_campaigns(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sp_campaigns_spend           ON public.sp_campaigns(profile_id, spend_cents DESC);

-- ============================================================
-- 5. SP_AD_GROUPS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sp_ad_groups (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  ad_group_id         BIGINT       NOT NULL,
  campaign_id         BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  ad_group_name       VARCHAR(255) NOT NULL,
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  default_bid_cents   INTEGER,
  impressions         INTEGER      NOT NULL DEFAULT 0,
  clicks              INTEGER      NOT NULL DEFAULT 0,
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  sales_cents         INTEGER      NOT NULL DEFAULT 0,
  orders              INTEGER      NOT NULL DEFAULT 0,
  units               INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, ad_group_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sp_ad_groups_profile_date ON public.sp_ad_groups(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sp_ad_groups_campaign     ON public.sp_ad_groups(campaign_id, date DESC);

-- ============================================================
-- 6. SP_KEYWORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sp_keywords (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  keyword_id          BIGINT       NOT NULL,
  ad_group_id         BIGINT       NOT NULL,
  campaign_id         BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  keyword_text        VARCHAR(500) NOT NULL,
  match_type          VARCHAR(30)  NOT NULL,             -- broad | phrase | exact
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  bid_cents           INTEGER,
  impressions         INTEGER      NOT NULL DEFAULT 0,
  clicks              INTEGER      NOT NULL DEFAULT 0,
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  sales_cents         INTEGER      NOT NULL DEFAULT 0,
  orders              INTEGER      NOT NULL DEFAULT 0,
  units               INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sp_keywords_profile_date   ON public.sp_keywords(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sp_keywords_campaign       ON public.sp_keywords(campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sp_keywords_zero_sales     ON public.sp_keywords(profile_id, state) WHERE sales_cents = 0 AND spend_cents > 0;

-- ============================================================
-- 7. SP_SEARCH_TERMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sp_search_terms (
  id                    BIGSERIAL    PRIMARY KEY,
  profile_id            BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  campaign_id           BIGINT       NOT NULL,
  ad_group_id           BIGINT       NOT NULL,
  date                  DATE         NOT NULL,
  customer_search_term  VARCHAR(500) NOT NULL,
  keyword_id            BIGINT,
  match_type            VARCHAR(30),
  impressions           INTEGER      NOT NULL DEFAULT 0,
  clicks                INTEGER      NOT NULL DEFAULT 0,
  spend_cents           INTEGER      NOT NULL DEFAULT 0,
  sales_cents           INTEGER      NOT NULL DEFAULT 0,
  orders                INTEGER      NOT NULL DEFAULT 0,
  units                 INTEGER      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, campaign_id, ad_group_id, customer_search_term, date)
);

CREATE INDEX IF NOT EXISTS idx_sp_search_terms_profile_date   ON public.sp_search_terms(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sp_search_terms_wasted         ON public.sp_search_terms(profile_id, date) WHERE sales_cents = 0 AND spend_cents > 0;
CREATE INDEX IF NOT EXISTS idx_sp_search_terms_converters     ON public.sp_search_terms(profile_id, date) WHERE orders > 0;

-- ============================================================
-- 8. SP_PRODUCT_TARGETS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sp_product_targets (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  target_id           BIGINT       NOT NULL,
  ad_group_id         BIGINT       NOT NULL,
  campaign_id         BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  target_expression   TEXT         NOT NULL,             -- ASIN or category expression
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  bid_cents           INTEGER,
  impressions         INTEGER      NOT NULL DEFAULT 0,
  clicks              INTEGER      NOT NULL DEFAULT 0,
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  sales_cents         INTEGER      NOT NULL DEFAULT 0,
  orders              INTEGER      NOT NULL DEFAULT 0,
  units               INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, target_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sp_product_targets_profile_date ON public.sp_product_targets(profile_id, date DESC);

-- ============================================================
-- 9. SB_CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sb_campaigns (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  campaign_id         BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  campaign_name       VARCHAR(255) NOT NULL,
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  daily_budget_cents  INTEGER,
  portfolio_id        BIGINT,
  ad_format           VARCHAR(50),                       -- productCollection | video | storeSpotlight
  impressions         INTEGER      NOT NULL DEFAULT 0,
  clicks              INTEGER      NOT NULL DEFAULT 0,
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  sales_cents         INTEGER      NOT NULL DEFAULT 0,
  orders              INTEGER      NOT NULL DEFAULT 0,
  units               INTEGER      NOT NULL DEFAULT 0,
  video_views         INTEGER      NOT NULL DEFAULT 0,
  video_view_rate     NUMERIC(8,4) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sb_campaigns_profile_date ON public.sb_campaigns(profile_id, date DESC);

-- ============================================================
-- 10. SB_KEYWORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sb_keywords (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  keyword_id          BIGINT       NOT NULL,
  ad_group_id         BIGINT,
  campaign_id         BIGINT       NOT NULL,
  date                DATE         NOT NULL,
  keyword_text        VARCHAR(500) NOT NULL,
  match_type          VARCHAR(30)  NOT NULL,
  state               VARCHAR(50)  NOT NULL DEFAULT 'enabled',
  bid_cents           INTEGER,
  impressions         INTEGER      NOT NULL DEFAULT 0,
  clicks              INTEGER      NOT NULL DEFAULT 0,
  spend_cents         INTEGER      NOT NULL DEFAULT 0,
  sales_cents         INTEGER      NOT NULL DEFAULT 0,
  orders              INTEGER      NOT NULL DEFAULT 0,
  units               INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sb_keywords_profile_date ON public.sb_keywords(profile_id, date DESC);

-- ============================================================
-- 11. SB_SEARCH_TERMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sb_search_terms (
  id                    BIGSERIAL    PRIMARY KEY,
  profile_id            BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  campaign_id           BIGINT       NOT NULL,
  ad_group_id           BIGINT,
  date                  DATE         NOT NULL,
  customer_search_term  VARCHAR(500) NOT NULL,
  keyword_id            BIGINT,
  match_type            VARCHAR(30),
  impressions           INTEGER      NOT NULL DEFAULT 0,
  clicks                INTEGER      NOT NULL DEFAULT 0,
  spend_cents           INTEGER      NOT NULL DEFAULT 0,
  sales_cents           INTEGER      NOT NULL DEFAULT 0,
  orders                INTEGER      NOT NULL DEFAULT 0,
  units                 INTEGER      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, campaign_id, ad_group_id, customer_search_term, date)
);

CREATE INDEX IF NOT EXISTS idx_sb_search_terms_profile_date ON public.sb_search_terms(profile_id, date DESC);

-- ============================================================
-- 12. SYNC_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sync_logs (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  triggered_by        VARCHAR(20)  NOT NULL DEFAULT 'scheduler', -- scheduler | manual
  status              VARCHAR(20)  NOT NULL DEFAULT 'running',   -- running | success | failed | partial
  started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  records_upserted    INTEGER      NOT NULL DEFAULT 0,
  error_message       TEXT,
  date_range_start    DATE,
  date_range_end      DATE,
  metadata            JSONB        NOT NULL DEFAULT '{}'         -- per-report-type counts
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_profile_started ON public.sync_logs(profile_id, started_at DESC);

-- ============================================================
-- 13. ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.alerts (
  id                  BIGSERIAL    PRIMARY KEY,
  profile_id          BIGINT       NOT NULL REFERENCES public.amazon_profiles(profile_id) ON DELETE CASCADE,
  alert_type          VARCHAR(100) NOT NULL,  -- HIGH_ACOS | ZERO_SALE_KEYWORD | BUDGET_EXHAUSTION | etc.
  severity            VARCHAR(20)  NOT NULL,  -- high | medium | low
  entity_type         VARCHAR(50)  NOT NULL,  -- campaign | keyword | search_term | account
  entity_id           VARCHAR(255) NOT NULL,
  entity_name         VARCHAR(500) NOT NULL,
  message             TEXT         NOT NULL,
  suggested_action    TEXT,
  triggered_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  dismissed_at        TIMESTAMPTZ,
  actioned_at         TIMESTAMPTZ,
  dismiss_reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_profile_active  ON public.alerts(profile_id, triggered_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_severity        ON public.alerts(profile_id, severity) WHERE dismissed_at IS NULL;

-- ============================================================
-- MATERIALIZED VIEWS (pre-aggregated for fast dashboard queries)
-- ============================================================

-- 7-day campaign rollup
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_sp_campaigns_7d AS
SELECT
  profile_id,
  campaign_id,
  MAX(campaign_name)                        AS campaign_name,
  MAX(state)                                AS state,
  SUM(impressions)                          AS impressions,
  SUM(clicks)                               AS clicks,
  SUM(spend_cents)                          AS spend_cents,
  SUM(sales_cents)                          AS sales_cents,
  SUM(orders)                               AS orders,
  CASE WHEN SUM(sales_cents) > 0
    THEN ROUND((SUM(spend_cents)::NUMERIC / SUM(sales_cents)) * 100, 2)
    ELSE NULL END                           AS acos,
  CASE WHEN SUM(spend_cents) > 0
    THEN ROUND(SUM(sales_cents)::NUMERIC / SUM(spend_cents), 4)
    ELSE NULL END                           AS roas,
  CASE WHEN SUM(clicks) > 0
    THEN ROUND(SUM(spend_cents)::NUMERIC / SUM(clicks), 0)
    ELSE NULL END                           AS cpc_cents,
  MIN(date)                                 AS period_start,
  MAX(date)                                 AS period_end
FROM public.sp_campaigns
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY profile_id, campaign_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sp_campaigns_7d ON public.mv_sp_campaigns_7d(profile_id, campaign_id);

-- 30-day campaign rollup
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_sp_campaigns_30d AS
SELECT
  profile_id,
  campaign_id,
  MAX(campaign_name)                        AS campaign_name,
  MAX(state)                                AS state,
  SUM(impressions)                          AS impressions,
  SUM(clicks)                               AS clicks,
  SUM(spend_cents)                          AS spend_cents,
  SUM(sales_cents)                          AS sales_cents,
  SUM(orders)                               AS orders,
  CASE WHEN SUM(sales_cents) > 0
    THEN ROUND((SUM(spend_cents)::NUMERIC / SUM(sales_cents)) * 100, 2)
    ELSE NULL END                           AS acos,
  CASE WHEN SUM(spend_cents) > 0
    THEN ROUND(SUM(sales_cents)::NUMERIC / SUM(spend_cents), 4)
    ELSE NULL END                           AS roas,
  CASE WHEN SUM(clicks) > 0
    THEN ROUND(SUM(spend_cents)::NUMERIC / SUM(clicks), 0)
    ELSE NULL END                           AS cpc_cents
FROM public.sp_campaigns
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY profile_id, campaign_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sp_campaigns_30d ON public.mv_sp_campaigns_30d(profile_id, campaign_id);

-- Daily account summary (for trend chart)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_account_daily_summary AS
SELECT
  profile_id,
  date,
  SUM(impressions)  AS impressions,
  SUM(clicks)       AS clicks,
  SUM(spend_cents)  AS spend_cents,
  SUM(sales_cents)  AS sales_cents,
  SUM(orders)       AS orders,
  COUNT(DISTINCT campaign_id) AS active_campaigns
FROM public.sp_campaigns
GROUP BY profile_id, date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_account_daily_summary ON public.mv_account_daily_summary(profile_id, date DESC);

-- Function to refresh all materialized views (call after each sync)
CREATE OR REPLACE FUNCTION public.refresh_materialized_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_sp_campaigns_7d;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_sp_campaigns_30d;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_account_daily_summary;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) - Users can only see their own data
-- ============================================================

ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_ad_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_keywords       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_search_terms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_product_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sb_campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sb_keywords       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sb_search_terms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts            ENABLE ROW LEVEL SECURITY;

-- Drop all policies before recreating (safe to re-run)
DO $$ DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- users: own row only
CREATE POLICY "users_own" ON public.users
  FOR ALL USING (auth.uid() = id);

-- amazon_profiles: own profiles only
CREATE POLICY "profiles_own" ON public.amazon_profiles
  FOR ALL USING (auth.uid() = user_id);

-- Helper function: returns profile_ids belonging to the current user
CREATE OR REPLACE FUNCTION public.my_profile_ids()
RETURNS SETOF BIGINT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT profile_id FROM public.amazon_profiles WHERE user_id = auth.uid();
$$;

-- All data tables: access only via owned profiles
CREATE POLICY "portfolios_own"         ON public.portfolios          FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sp_campaigns_own"       ON public.sp_campaigns        FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sp_ad_groups_own"       ON public.sp_ad_groups        FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sp_keywords_own"        ON public.sp_keywords         FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sp_search_terms_own"    ON public.sp_search_terms     FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sp_product_targets_own" ON public.sp_product_targets  FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sb_campaigns_own"       ON public.sb_campaigns        FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sb_keywords_own"        ON public.sb_keywords         FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sb_search_terms_own"    ON public.sb_search_terms     FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "sync_logs_own"          ON public.sync_logs           FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));
CREATE POLICY "alerts_own"             ON public.alerts              FOR ALL USING (profile_id IN (SELECT public.my_profile_ids()));

-- Service role bypass (for server-side sync engine)
CREATE POLICY "service_all_users"      ON public.users             FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_profiles"   ON public.amazon_profiles   FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_portfolios" ON public.portfolios        FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sp_camps"   ON public.sp_campaigns      FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sp_adgrp"   ON public.sp_ad_groups      FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sp_kw"      ON public.sp_keywords       FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sp_st"      ON public.sp_search_terms   FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sp_pt"      ON public.sp_product_targets FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sb_camps"   ON public.sb_campaigns      FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sb_kw"      ON public.sb_keywords       FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sb_st"      ON public.sb_search_terms   FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_sync_logs"  ON public.sync_logs         FOR ALL TO service_role USING (true);
CREATE POLICY "service_all_alerts"     ON public.alerts            FOR ALL TO service_role USING (true);

-- ============================================================
-- END OF SCHEMA
-- ============================================================
