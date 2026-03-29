-- One-time backfill for the new SB attribution fact table.
-- Run this after deploying the schema change so historical SB sales/orders
-- continue to appear before each profile is re-synced.

INSERT INTO public.sb_campaign_attribution (
  profile_id,
  campaign_id,
  date,
  sales_cents,
  orders,
  source_report
)
SELECT
  profile_id,
  campaign_id,
  date,
  sales_cents,
  orders,
  'legacy_sb_campaigns'
FROM public.sb_campaigns
WHERE campaign_id > 0
  AND (sales_cents > 0 OR orders > 0)
ON CONFLICT (profile_id, campaign_id, date)
DO UPDATE SET
  sales_cents = EXCLUDED.sales_cents,
  orders = EXCLUDED.orders,
  source_report = EXCLUDED.source_report;
