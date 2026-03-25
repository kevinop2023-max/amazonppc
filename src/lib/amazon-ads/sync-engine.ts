// Amazon PPC Sync Engine
// Fetches SP/SB campaign, keyword and search term data from Amazon Ads API
// and upserts it into Supabase.

import { getClientForProfile } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import zlib from 'zlib'
import { promisify } from 'util'

const gunzip = promisify(zlib.gunzip)

// ── Report column definitions ──────────────────────────────────────────────

// Amazon Ads API v3 column names (state→campaignStatus/adKeywordStatus, bid→keywordBid, query→targeting)
const SP_CAMPAIGN_COLS  = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_ADGROUP_COLS   = ['date','campaignId','adGroupId','adGroupName','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_KEYWORD_COLS   = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_SEARCHTERM_COLS= ['date','campaignId','adGroupId','keywordId','matchType','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_CAMPAIGN_COLS  = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_KEYWORD_COLS   = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_SEARCHTERM_COLS= ['date','campaignId','adGroupId','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']

// ── Helpers ────────────────────────────────────────────────────────────────

function toCents(dollarStr: string | number | null | undefined): number {
  if (!dollarStr) return 0
  return Math.round(Number(dollarStr) * 100)
}

function dateStr(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

async function downloadAndParse(url: string): Promise<any[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buf      = Buffer.from(await res.arrayBuffer())
  const decompressed = await gunzip(buf)
  return JSON.parse(decompressed.toString('utf8'))
}

// ── Report creation + polling ──────────────────────────────────────────────

async function createAndWaitReport(
  client: ReturnType<typeof getClientForProfile> extends Promise<infer T> ? T : never,
  name: string,
  adProduct: 'SPONSORED_PRODUCTS' | 'SPONSORED_BRANDS',
  reportTypeId: string,
  groupBy: string[],
  columns: string[],
  startDate: string,
  endDate: string,
): Promise<any[]> {
  console.log(`[sync] Creating report: ${name} (reportTypeId=${reportTypeId}, groupBy=${groupBy})`)
  const { reportId } = await client.createReport({
    name,
    startDate,
    endDate,
    configuration: { adProduct, groupBy, columns, reportTypeId, timeUnit: 'DAILY', format: 'GZIP_JSON' },
  }).catch(err => { throw new Error(`[${name}] ${err.message}`) })

  const downloadUrl = await client.waitForReport(reportId)
  return downloadAndParse(downloadUrl)
}

// ── Upsert helpers ─────────────────────────────────────────────────────────

async function upsertSpCampaigns(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id:         profileId,
    campaign_id:        Number(r.campaignId),
    date:               r.date,
    campaign_name:      r.campaignName ?? '',
    state:              r.campaignStatus ?? 'enabled',
    daily_budget_cents: toCents(r.campaignBudgetAmount),
    impressions:        Number(r.impressions ?? 0),
    clicks:             Number(r.clicks ?? 0),
    spend_cents:        toCents(r.cost),
    sales_cents:        toCents(r.sales14d),
    orders:             Number(r.purchases14d ?? 0),
    units:              Number(r.unitsSoldClicks14d ?? 0),
  }))
  const { error } = await db.from('sp_campaigns').upsert(records, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sp_campaigns upsert: ${error.message}`)
  return records.length
}

async function upsertSpAdGroups(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id:    profileId,
    ad_group_id:   Number(r.adGroupId),
    campaign_id:   Number(r.campaignId),
    date:          r.date,
    ad_group_name: r.adGroupName ?? '',
    impressions:   Number(r.impressions ?? 0),
    clicks:        Number(r.clicks ?? 0),
    spend_cents:   toCents(r.cost),
    sales_cents:   toCents(r.sales14d),
    orders:        Number(r.purchases14d ?? 0),
    units:         Number(r.unitsSoldClicks14d ?? 0),
  }))
  const { error } = await db.from('sp_ad_groups').upsert(records, { onConflict: 'profile_id,ad_group_id,date' })
  if (error) throw new Error(`sp_ad_groups upsert: ${error.message}`)
  return records.length
}

async function upsertSpKeywords(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows
    .filter(r => r.keywordId)
    .map(r => ({
      profile_id:   profileId,
      keyword_id:   Number(r.keywordId),
      ad_group_id:  Number(r.adGroupId),
      campaign_id:  Number(r.campaignId),
      date:         r.date,
      keyword_text: r.keyword ?? '',
      match_type:   (r.matchType ?? 'broad').toLowerCase(),
      state:        r.adKeywordStatus ?? 'enabled',
      bid_cents:    toCents(r.keywordBid),
      impressions:  Number(r.impressions ?? 0),
      clicks:       Number(r.clicks ?? 0),
      spend_cents:  toCents(r.cost),
      sales_cents:  toCents(r.sales14d),
      orders:       Number(r.purchases14d ?? 0),
      units:        Number(r.unitsSoldClicks14d ?? 0),
    }))
  if (!records.length) return 0
  const { error } = await db.from('sp_keywords').upsert(records, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sp_keywords upsert: ${error.message}`)
  return records.length
}

async function upsertSpSearchTerms(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id:           profileId,
    campaign_id:          Number(r.campaignId),
    ad_group_id:          Number(r.adGroupId),
    date:                 r.date,
    customer_search_term: r.targeting ?? '',
    keyword_id:           r.keywordId ? Number(r.keywordId) : null,
    match_type:           r.matchType ? r.matchType.toLowerCase() : null,
    impressions:          Number(r.impressions ?? 0),
    clicks:               Number(r.clicks ?? 0),
    spend_cents:          toCents(r.cost),
    sales_cents:          toCents(r.sales14d),
    orders:               Number(r.purchases14d ?? 0),
    units:                Number(r.unitsSoldClicks14d ?? 0),
  }))
  if (!records.length) return 0
  const { error } = await db.from('sp_search_terms').upsert(records, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sp_search_terms upsert: ${error.message}`)
  return records.length
}

async function upsertSbCampaigns(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id:    profileId,
    campaign_id:   Number(r.campaignId),
    date:          r.date,
    campaign_name: r.campaignName ?? '',
    state:              r.campaignStatus ?? 'enabled',
    daily_budget_cents: toCents(r.campaignBudgetAmount),
    impressions:        Number(r.impressions ?? 0),
    clicks:             Number(r.clicks ?? 0),
    spend_cents:        toCents(r.cost),
    sales_cents:        toCents(r.sales14d),
    orders:             Number(r.purchases14d ?? 0),
    units:              Number(r.unitsSoldClicks14d ?? 0),
  }))
  const { error } = await db.from('sb_campaigns').upsert(records, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sb_campaigns upsert: ${error.message}`)
  return records.length
}

async function upsertSbKeywords(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows
    .filter(r => r.keywordId)
    .map(r => ({
      profile_id:   profileId,
      keyword_id:   Number(r.keywordId),
      campaign_id:  Number(r.campaignId),
      ad_group_id:  r.adGroupId ? Number(r.adGroupId) : null,
      date:         r.date,
      keyword_text: r.keyword ?? '',
      match_type:   (r.matchType ?? 'broad').toLowerCase(),
      state:        r.adKeywordStatus ?? 'enabled',
      bid_cents:    toCents(r.keywordBid),
      impressions:  Number(r.impressions ?? 0),
      clicks:       Number(r.clicks ?? 0),
      spend_cents:  toCents(r.cost),
      sales_cents:  toCents(r.sales14d),
      orders:       Number(r.purchases14d ?? 0),
      units:        Number(r.unitsSoldClicks14d ?? 0),
    }))
  if (!records.length) return 0
  const { error } = await db.from('sb_keywords').upsert(records, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sb_keywords upsert: ${error.message}`)
  return records.length
}

async function upsertSbSearchTerms(db: SupabaseClient, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id:           profileId,
    campaign_id:          Number(r.campaignId),
    ad_group_id:          r.adGroupId ? Number(r.adGroupId) : null,
    date:                 r.date,
    customer_search_term: r.targeting ?? '',
    impressions:          Number(r.impressions ?? 0),
    clicks:               Number(r.clicks ?? 0),
    spend_cents:          toCents(r.cost),
    sales_cents:          toCents(r.sales14d),
    orders:               Number(r.purchases14d ?? 0),
    units:                Number(r.unitsSoldClicks14d ?? 0),
  }))
  if (!records.length) return 0
  const { error } = await db.from('sb_search_terms').upsert(records, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sb_search_terms upsert: ${error.message}`)
  return records.length
}

// ── Main sync function ─────────────────────────────────────────────────────

export async function syncProfile(profileId: number, triggeredBy: 'scheduler' | 'manual' = 'manual'): Promise<{
  success: boolean
  recordsUpserted: number
  error?: string
}> {
  const db      = createServiceClient()
  const endDate = dateStr(1)    // yesterday (Amazon attribution lag)
  const startDate = dateStr(4)  // 3-day lookback to capture attribution corrections

  // Create sync log
  const { data: log } = await db
    .from('sync_logs')
    .insert({ profile_id: profileId, triggered_by: triggeredBy, status: 'running', started_at: new Date().toISOString(), date_range_start: startDate, date_range_end: endDate })
    .select()
    .single()

  const logId = log?.id

  try {
    const client = await getClientForProfile(profileId)
    let totalRecords = 0

    // ── Request reports sequentially for better error tracing ────────────
    const spCampRows = await createAndWaitReport(client, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMPAIGN_COLS,   startDate, endDate)
    const spAdgRows  = await createAndWaitReport(client, 'SP AdGroups',  'SPONSORED_PRODUCTS', 'spAdGroups',   ['adGroup'],    SP_ADGROUP_COLS,    startDate, endDate)
    const spKwRows   = await createAndWaitReport(client, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KEYWORD_COLS,    startDate, endDate)
    const spStRows   = await createAndWaitReport(client, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_SEARCHTERM_COLS, startDate, endDate)
    const sbCampRows = await createAndWaitReport(client, 'SB Campaigns', 'SPONSORED_BRANDS',   'sbCampaigns',  ['campaign'],   SB_CAMPAIGN_COLS,   startDate, endDate).catch(() => [])
    const sbKwRows   = await createAndWaitReport(client, 'SB Keywords',  'SPONSORED_BRANDS',   'sbTargeting',  ['targeting'],  SB_KEYWORD_COLS,    startDate, endDate).catch(() => [])
    const sbStRows   = await createAndWaitReport(client, 'SB Terms',     'SPONSORED_BRANDS',   'sbSearchTerm', ['searchTerm'], SB_SEARCHTERM_COLS, startDate, endDate).catch(() => [])

    // ── Upsert all data ───────────────────────────────────────────────────
    totalRecords += await upsertSpCampaigns(db,  profileId, spCampRows)
    totalRecords += await upsertSpAdGroups(db,   profileId, spAdgRows)
    totalRecords += await upsertSpKeywords(db,   profileId, spKwRows)
    totalRecords += await upsertSpSearchTerms(db,profileId, spStRows)
    totalRecords += await upsertSbCampaigns(db,  profileId, sbCampRows)
    totalRecords += await upsertSbKeywords(db,   profileId, sbKwRows)
    totalRecords += await upsertSbSearchTerms(db,profileId, sbStRows)

    // Update last_sync_at on profile
    await db.from('amazon_profiles').update({ last_sync_at: new Date().toISOString() }).eq('profile_id', profileId)

    // Mark sync log success
    if (logId) {
      await db.from('sync_logs').update({
        status: 'success', completed_at: new Date().toISOString(), records_upserted: totalRecords,
      }).eq('id', logId)
    }

    return { success: true, recordsUpserted: totalRecords }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (logId) {
      await db.from('sync_logs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: msg }).eq('id', logId)
    }
    return { success: false, recordsUpserted: 0, error: msg }
  }
}
