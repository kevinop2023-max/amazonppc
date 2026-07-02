// Phase 1: Create all Amazon reports in parallel, save IDs to sync_logs, return immediately.
// A pg_cron job calls sync-poll every minute to check status and download when ready.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AMAZON_LWA_CLIENT_ID      = Deno.env.get('AMAZON_LWA_CLIENT_ID')!
const AMAZON_LWA_CLIENT_SECRET  = Deno.env.get('AMAZON_LWA_CLIENT_SECRET')!
const TOKEN_ENCRYPTION_KEY      = Deno.env.get('TOKEN_ENCRYPTION_KEY')!

const AMAZON_ADS_BASE = 'https://advertising-api.amazon.com'
const LWA_TOKEN_URL   = 'https://api.amazon.com/auth/o2/token'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Crypto ────────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) a[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return a
}

async function decryptToken(enc: string): Promise<string> {
  const iv = hexToBytes(enc.slice(0, 24)), tag = hexToBytes(enc.slice(24, 56)), cipher = hexToBytes(enc.slice(56))
  const combined = new Uint8Array(cipher.length + tag.length)
  combined.set(cipher); combined.set(tag, cipher.length)
  const key = await crypto.subtle.importKey('raw', hexToBytes(TOKEN_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, combined))
}

async function encryptToken(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', hexToBytes(TOKEN_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['encrypt'])
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plain)))
  const h = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return h(iv) + h(enc.slice(-16)) + h(enc.slice(0, -16))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

async function refreshAccessToken(rt: string) {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: AMAZON_LWA_CLIENT_ID, client_secret: AMAZON_LWA_CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`Token refresh: ${res.status} ${await res.text()}`)
  const d = await res.json()
  return { accessToken: d.access_token, expiresAt: new Date(Date.now() + (d.expires_in - 60) * 1000) }
}

async function createReport(token: string, pid: string, name: string, adProduct: string, typeId: string, groupBy: string[], cols: string[], start: string, end: string, filters?: Array<{field: string, values: string[]}>, maxRetries = 3): Promise<string | null> {
  const RETRY_WAITS = [15000, 30000, 60000].slice(0, maxRetries)
  for (let attempt = 1; attempt <= RETRY_WAITS.length + 1; attempt++) {
    try {
      const config: Record<string, any> = { adProduct, groupBy, columns: cols, reportTypeId: typeId, timeUnit: 'DAILY', format: 'GZIP_JSON' }
      if (filters?.length) config.filters = filters
      const res = await fetch(`${AMAZON_ADS_BASE}/reporting/reports`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
          'Amazon-Advertising-API-Scope': pid,
          'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
        },
        body: JSON.stringify({ name, startDate: start, endDate: end, configuration: config }),
      })
      const text = await res.text()
      if (res.status === 429) {
        const wait = RETRY_WAITS[attempt - 1]
        if (wait == null) break  // last attempt was throttled — no more waits, exit loop immediately
        console.log(`[sync] ${name} throttled (attempt ${attempt}/${RETRY_WAITS.length + 1}), retrying in ${wait / 1000}s... body=${text.slice(0, 200)}`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        const dup = text.match(/duplicate of\s*[:\s]+([a-f0-9-]{36})/i)
        if (dup) { console.log(`[sync] Reuse ${name} → ${dup[1]}`); return dup[1] }
        console.error(`[sync] FAIL ${name}: HTTP ${res.status} → ${text.slice(0, 400)}`); return null
      }
      const d = text.trim().startsWith('[') ? JSON.parse(text)[0] : JSON.parse(text.split('\n')[0])
      console.log(`[sync] Created ${name} → ${d.reportId}`); return d.reportId
    } catch (e) { console.error(`[sync] Skip ${name}: ${e}`); return null }
  }
  console.error(`[sync] Skip ${name}: exhausted retries`); return null
}

// ── Campaign state snapshot ───────────────────────────────────────────────────
// Performance reports only include campaigns with activity (spend/impressions).
// Paused/archived campaigns never appear in reports, so their state would never
// be stored in the DB and the state filter would always show 0 for those states.
// This function calls the Amazon campaign list API to store the CURRENT state of
// ALL campaigns (including paused/archived) for today's date. Today's date is
// after endStr (= yesterday), so it is excluded from performance aggregations
// but included in the meta (all-time) query used for state filtering.
// Shared v3/v4 campaign-list fetch (POST /list, nextToken pagination). Returns all states.
// SP: /sp/campaigns/list + spCampaign.v3 (budget nested: c.budget.budget)
// SB: /sb/v4/campaigns/list + sbCampaign.v4 (budget flat: c.budget)
async function fetchCampaignList(token: string, pid: string, path: string, mediaType: string, dataKey = 'campaigns'): Promise<any[]> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
    'Amazon-Advertising-API-Scope': pid,
    'Content-Type': `application/vnd.${mediaType}+json`,
    'Accept': `application/vnd.${mediaType}+json`,
  }
  const all: any[] = []
  let nextToken: string | null = null
  for (let page = 0; page < 100; page++) {
    // maxResults 100 — SB v4 rejects larger values (SP v3 allows more, but 100 is safe for both)
    const body: any = { maxResults: 100, stateFilter: { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] } }
    if (nextToken) body.nextToken = nextToken
    const res = await fetch(`${AMAZON_ADS_BASE}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    if (!res.ok) { console.log(`[sync] list ${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`); break }
    const data = await res.json()
    const rows = data[dataKey] ?? []
    all.push(...rows)
    nextToken = data.nextToken ?? null
    if (!nextToken) break
  }
  return all
}

async function syncCampaignStates(token: string, pid: string, db: any, numericPid: number) {
  const today = new Date().toISOString().split('T')[0]
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
    'Amazon-Advertising-API-Scope': pid,
  }

  async function listAll(path: string): Promise<any[]> {
    const all: any[] = []
    let startIndex = 0
    for (let page = 0; page < 20; page++) {  // max 2000 campaigns
      const res = await fetch(
        `${AMAZON_ADS_BASE}${path}?stateFilter=enabled,paused,archived&count=100&startIndex=${startIndex}`,
        { headers: h }
      )
      if (!res.ok) { console.log(`[sync] campaign-states ${path}: HTTP ${res.status}`); break }
      const data = await res.json()
      if (!Array.isArray(data) || !data.length) break
      all.push(...data)
      if (data.length < 100) break
      startIndex += 100
    }
    return all
  }

  const [sp, sb, sd, spAdGroups] = await Promise.all([
    // SP → v3 POST /list (budget nested), SB → v4 POST /list (budget flat), SD → legacy GET (no v3/v4 POST)
    fetchCampaignList(token, pid, '/sp/campaigns/list', 'spCampaign.v3').catch(e => { console.log(`[sync] sp-list: ${e}`); return [] }),
    fetchCampaignList(token, pid, '/sb/v4/campaigns/list', 'sbCampaign.v4').catch(e => { console.log(`[sync] sb-list: ${e}`); return [] }),
    listAll('/sd/campaigns').catch(e    => { console.log(`[sync] sd-list: ${e}`); return [] }),
    // SP ad groups (spAdGroup.v3) — for default-bid change history + hierarchy
    fetchCampaignList(token, pid, '/sp/adGroups/list', 'spAdGroup.v3', 'adGroups').catch(e => { console.log(`[sync] sp-adgroups: ${e}`); return [] }),
  ])

  const upsert = async (table: string, rows: object[]) => {
    if (!rows.length) return
    // ignoreDuplicates: true → DO NOTHING on conflict, so existing perf data is not overwritten with 0s
    const { error } = await (db as any).from(table).upsert(rows, { onConflict: 'profile_id,campaign_id,date', ignoreDuplicates: true })
    if (error) console.log(`[sync] ${table} state-upsert: ${error.message}`)
    else console.log(`[sync] campaign-states ${table}: ${rows.length} rows`)
  }

  const state = (v: any) => String(v ?? 'enabled').toLowerCase()
  const budgetCents = (v: any) => v ? Math.round(Number(v) * 100) : 0
  // SP placement bid multiplier (percent) for a given placement key; 0 = no adjustment set
  // (so the snapshot-diff can detect adjustments being added/removed). dynamicBidding.placementBidding = [{placement, percentage}]
  const placementPct = (c: any, key: string) => {
    const arr = c?.dynamicBidding?.placementBidding ?? []
    const m = arr.find((x: any) => x.placement === key)
    return m ? Number(m.percentage) : 0
  }

  await Promise.all([
    upsert('sp_campaigns', sp.map(c => ({          // v3: budget nested under c.budget.budget
      profile_id: numericPid, campaign_id: Number(c.campaignId), date: today,
      campaign_name: c.name ?? '', state: state(c.state),
      daily_budget_cents: budgetCents(c.budget?.budget),
      bidding_strategy: c.dynamicBidding?.strategy ?? null,
      placement_top_pct:     placementPct(c, 'PLACEMENT_TOP'),
      placement_product_pct: placementPct(c, 'PLACEMENT_PRODUCT_PAGE'),
      placement_rest_pct:    placementPct(c, 'PLACEMENT_REST_OF_SEARCH'),
      impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0, units: 0,
    }))),
    upsert('sb_campaigns', sb.map(c => ({          // v4: budget flat on c.budget
      profile_id: numericPid, campaign_id: Number(c.campaignId), date: today,
      campaign_name: c.name ?? '', state: state(c.state),
      daily_budget_cents: budgetCents(c.budget),
      impressions: 0, clicks: 0, spend_cents: 0,
    }))),
    upsert('sd_campaigns', sd.map(c => ({          // legacy GET: budget on c.dailyBudget
      profile_id: numericPid, campaign_id: Number(c.campaignId), date: today,
      campaign_name: c.name ?? '', state: state(c.state),
      daily_budget_cents: budgetCents(c.dailyBudget),
      impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0, units: 0,
    }))),
  ])

  // SP ad-group daily snapshot (default bid + state) — for default-bid change history.
  if (spAdGroups.length) {
    const agRows = spAdGroups.map((a: any) => ({
      profile_id: numericPid, ad_group_id: Number(a.adGroupId), campaign_id: Number(a.campaignId), date: today,
      ad_group_name: a.name ?? '', state: state(a.state),
      default_bid_cents: budgetCents(a.defaultBid),   // defaultBid is in marketplace currency (dollars)
      impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0, units: 0,
    }))
    const { error } = await (db as any).from('sp_ad_groups').upsert(agRows, { onConflict: 'profile_id,ad_group_id,date', ignoreDuplicates: true })
    if (error) console.log(`[sync] sp_ad_groups upsert: ${error.message}`)
    else console.log(`[sync] ad-group snapshot: ${agRows.length} rows`)
  }
}

// ── Negative keyword + target snapshot ───────────────────────────────────────
// Uses v3 SP management API (POST /list) + v2 SB GET endpoint.
// SP has BOTH campaign-level and ad-group-level negative keywords — both are fetched.
async function syncNegativeKeywords(token: string, pid: string, db: any, numericPid: number) {
  const baseH: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
    'Amazon-Advertising-API-Scope': pid,
  }

  // v3 SP management API uses POST /list with nextToken pagination
  async function listV3Post(path: string, mediaType: string, dataKey: string): Promise<any[]> {
    const all: any[] = []
    let nextToken: string | null = null
    for (let page = 0; page < 50; page++) {
      const body: any = { maxResults: 100 }
      if (nextToken) body.nextToken = nextToken
      const res = await fetch(`${AMAZON_ADS_BASE}${path}`, {
        method: 'POST',
        headers: { ...baseH, 'Content-Type': `application/vnd.${mediaType}+json`, 'Accept': `application/vnd.${mediaType}+json` },
        body: JSON.stringify(body),
      })
      if (!res.ok) { console.log(`[sync] neg ${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`); break }
      const data = await res.json()
      const rows: any[] = data[dataKey] ?? []
      all.push(...rows)
      nextToken = data.nextToken ?? null
      if (!nextToken || rows.length < 100) break
    }
    return all
  }

  // v2 GET endpoint for SB negative keywords (SB management API still uses GET)
  async function listV2Get(path: string): Promise<any[]> {
    const all: any[] = []
    let start = 0
    for (let page = 0; page < 50; page++) {
      const res = await fetch(`${AMAZON_ADS_BASE}${path}?count=100&startIndex=${start}`, { headers: baseH })
      if (!res.ok) { console.log(`[sync] neg ${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`); break }
      const data = await res.json()
      const rows = Array.isArray(data) ? data : (data.negativeKeywords ?? [])
      if (!rows.length) break
      all.push(...rows)
      if (rows.length < 100) break
      start += 100
    }
    return all
  }

  // Fetch SP campaign-level negatives, SP ad-group-level negatives, SP negative targets, SB negatives
  // Media types + response keys confirmed via live API error messages (2026-06-04):
  // - ad-group neg keywords: endpoint is /sp/negativeKeywords/list (NOT adGroupNegativeKeywords)
  // - neg targets media type: spnegativeTargetingClause.v3 (lowercase 'n'), key: negativeTargetingClauses
  const [spCampNegKw, spAdGrpNegKw, spNegTgt, sbNegKw] = await Promise.all([
    listV3Post('/sp/campaignNegativeKeywords/list', 'spCampaignNegativeKeyword.v3', 'campaignNegativeKeywords')
      .catch(e => { console.log(`[sync] sp-camp-neg-kw: ${e}`); return [] }),
    listV3Post('/sp/negativeKeywords/list', 'spNegativeKeyword.v3', 'negativeKeywords')
      .catch(e => { console.log(`[sync] sp-adgrp-neg-kw: ${e}`); return [] }),
    listV3Post('/sp/negativeTargets/list', 'spnegativeTargetingClause.v3', 'negativeTargetingClauses')
      .catch(e => { console.log(`[sync] sp-neg-tgt: ${e}`); return [] }),
    listV2Get('/sb/negativeKeywords')
      .catch(e => { console.log(`[sync] sb-neg-kw: ${e}`); return [] }),
  ])

  // Fetch campaign id→name for ALL campaigns (incl. archived) so negatives on old campaigns get real names.
  // SP via v3 list, SB via v4 list (shared helper, nextToken pagination).
  const campNames = new Map<number, string>()
  const [spCamps, sbCamps] = await Promise.all([
    fetchCampaignList(token, pid, '/sp/campaigns/list', 'spCampaign.v3').catch(e => { console.log(`[sync] sp campaign-names: ${e}`); return [] }),
    fetchCampaignList(token, pid, '/sb/v4/campaigns/list', 'sbCampaign.v4').catch(e => { console.log(`[sync] sb campaign-names: ${e}`); return [] }),
  ])
  for (const c of spCamps) campNames.set(Number(c.campaignId), c.name ?? '')
  for (const c of sbCamps) campNames.set(Number(c.campaignId), c.name ?? '')
  const cname = (id: number) => campNames.get(id) ?? null

  const upsertNeg = async (table: string, conflictCol: string, rows: object[]) => {
    if (!rows.length) return
    const { error } = await (db as any).from(table).upsert(rows, { onConflict: `profile_id,${conflictCol}`, ignoreDuplicates: false })
    if (error) console.log(`[sync] ${table} neg-upsert: ${error.message}`)
    else console.log(`[sync] ${table}: ${rows.length} rows`)
  }

  // Merge campaign-level + ad-group-level SP negatives into sp_negative_keywords (ad_group_id nullable)
  const allSpNegKw = [
    ...spCampNegKw.map((k: any) => ({
      profile_id: numericPid, campaign_id: Number(k.campaignId), ad_group_id: null,
      campaign_name: cname(Number(k.campaignId)),
      keyword_id: Number(k.keywordId), keyword_text: k.keywordText ?? '', match_type: (k.matchType ?? 'negativeExact').toLowerCase(),
      state: (k.state ?? 'enabled').toLowerCase(), synced_at: new Date().toISOString(),
    })),
    ...spAdGrpNegKw.map((k: any) => ({
      profile_id: numericPid, campaign_id: Number(k.campaignId), ad_group_id: k.adGroupId ? Number(k.adGroupId) : null,
      campaign_name: cname(Number(k.campaignId)),
      keyword_id: Number(k.keywordId), keyword_text: k.keywordText ?? '', match_type: (k.matchType ?? 'negativeExact').toLowerCase(),
      state: (k.state ?? 'enabled').toLowerCase(), synced_at: new Date().toISOString(),
    })),
  ]

  await Promise.all([
    upsertNeg('sp_negative_keywords', 'keyword_id', allSpNegKw),
    upsertNeg('sb_negative_keywords', 'keyword_id', sbNegKw.map((k: any) => ({
      profile_id: numericPid, campaign_id: Number(k.campaignId), campaign_name: cname(Number(k.campaignId)),
      keyword_id: Number(k.keywordId), keyword_text: k.keywordText ?? '', match_type: (k.matchType ?? 'negativeExact').toLowerCase(),
      state: (k.state ?? 'enabled').toLowerCase(), synced_at: new Date().toISOString(),
    }))),
    upsertNeg('sp_negative_targets', 'target_id', spNegTgt.map((t: any) => ({
      profile_id: numericPid, campaign_id: Number(t.campaignId), ad_group_id: t.adGroupId ? Number(t.adGroupId) : null,
      campaign_name: cname(Number(t.campaignId)),
      target_id: Number(t.negativeTargetId ?? t.targetId),
      expression: t.expression ? JSON.stringify(t.expression) : (t.targetingExpression ? JSON.stringify(t.targetingExpression) : null),
      state: (t.state ?? 'enabled').toLowerCase(), synced_at: new Date().toISOString(),
    }))),
  ])

  console.log(`[sync] negatives — spCampKw:${spCampNegKw.length} spAdGrpKw:${spAdGrpNegKw.length} spTgt:${spNegTgt.length} sbKw:${sbNegKw.length}`)
}

// ── Change history ingest (Amazon /history API) ───────────────────────────────
// Amazon exposes a REAL change-history API (POST /history) for SP + SB: campaign,
// ad group, keyword, target, negative-keyword changes — with exact previous→new
// values and real edit timestamps, up to 90 days back. (SD is NOT covered.)
// We store every event in `change_events`. First run for a profile = 90-day
// backfill; subsequent runs = incremental from the latest stored event_ts (with a
// 1-day overlap; the UNIQUE constraint makes re-ingest idempotent).
// Response event shape (confirmed from docs):
//   { changeType, entityType, entityId, metadata, previousValue, newValue, timestamp }
// Value semantics by changeType: amounts (BID_AMOUNT/BUDGET_AMOUNT/DEFAULT_BID_AMOUNT)
//   = marketplace-currency dollars (→ store cents); PLACEMENT_GROUP = percent;
//   STATUS/SMART_BIDDING_STRATEGY/NAME/IN_BUDGET/dates = text.
const HISTORY_AMOUNT_FIELDS = new Set(['BID_AMOUNT', 'BUDGET_AMOUNT', 'DEFAULT_BID_AMOUNT'])

function mapHistoryEvent(ev: any, numericPid: number): any | null {
  const ts = Number(ev?.timestamp)
  if (!ts || !ev?.entityType || ev?.entityId == null || !ev?.changeType) return null
  const field = String(ev.changeType)
  const entityType = String(ev.entityType)
  const md = ev.metadata ?? null

  const parseNum = (v: any) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  let old_value: number | null = null, new_value: number | null = null
  if (HISTORY_AMOUNT_FIELDS.has(field)) {
    const o = parseNum(ev.previousValue), n = parseNum(ev.newValue)
    old_value = o == null ? null : Math.round(o * 100)   // dollars → cents
    new_value = n == null ? null : Math.round(n * 100)
  } else if (field === 'PLACEMENT_GROUP') {
    old_value = parseNum(ev.previousValue)               // percent multiplier
    new_value = parseNum(ev.newValue)
  }

  // metadata field names not yet confirmed → best-effort parent linkage, raw kept in metadata.
  const mdGet = (k: string) => (md && md[k] != null ? String(md[k]) : null)
  const eid = String(ev.entityId)

  return {
    profile_id: numericPid,
    ad_type: null,                                       // not in event; backfilled later if metadata exposes it
    entity_type: entityType,
    entity_id: eid,
    campaign_id: mdGet('campaignId') ?? (entityType === 'CAMPAIGN' ? eid : null),
    ad_group_id: mdGet('adGroupId') ?? (entityType === 'AD_GROUP' ? eid : null),
    field,
    old_value, new_value,
    old_text: ev.previousValue != null ? String(ev.previousValue) : null,
    new_text: ev.newValue != null ? String(ev.newValue) : null,
    event_ts: new Date(ts).toISOString(),
    metadata: md,
  }
}

async function syncChangeHistory(token: string, pid: string, db: any, numericPid: number) {
  const now = Date.now()
  // 90 days is the hard API limit; Amazon rejects fromDate even microseconds past it
  // (request latency pushes an exact -90d value over the edge). Stay 1 hour inside.
  const MAX_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000

  // Incremental window: from latest stored API event (minus 1-day overlap), else 90-day backfill.
  // Scope to source='api' — otherwise recent snapshot-diff rows would shrink the window and skip
  // the initial 90-day API backfill on the first real run.
  let fromMs = now - MAX_LOOKBACK_MS
  const { data: latest } = await db.from('change_events')
    .select('event_ts').eq('profile_id', numericPid).eq('source', 'api')
    .order('event_ts', { ascending: false }).limit(1).maybeSingle()
  if (latest?.event_ts) {
    fromMs = Math.max(fromMs, new Date(latest.event_ts).getTime() - 24 * 60 * 60 * 1000)
  }
  const toMs = now

  // Request filters use the request-side enum (DEFAULT_BID_AMOUNT is requested as BID_AMOUNT for AD_GROUP).
  // `parents` is REQUIRED — without it /history silently returns 200/totalRecords:0 (confirmed w/ Amazon
  // Support 2026-07-01: adding parents unblocked it → 3752 records). useProfileIdAdvertiser scopes the
  // query to every entity under the authenticated advertiser (the whole profile).
  const PARENTS = [{ useProfileIdAdvertiser: true }]
  const eventTypes: Record<string, any> = {
    CAMPAIGN:          { filters: ['STATUS', 'IN_BUDGET', 'BUDGET_AMOUNT', 'NAME', 'START_DATE', 'END_DATE', 'SMART_BIDDING_STRATEGY', 'PLACEMENT_GROUP'], parents: PARENTS },
    AD_GROUP:          { filters: ['STATUS', 'NAME', 'BID_AMOUNT'], parents: PARENTS },
    KEYWORD:           { filters: ['STATUS', 'BID_AMOUNT'], parents: PARENTS },
    PRODUCT_TARGETING: { filters: ['STATUS', 'BID_AMOUNT'], parents: PARENTS },
    NEGATIVE_KEYWORD:  { filters: ['STATUS'], parents: PARENTS },
    AD:                { filters: ['STATUS'], parents: PARENTS },
  }

  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
    'Amazon-Advertising-API-Scope': pid,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.historyresponse.v1.1+json',
  }

  const all: any[] = []
  let firstDiag: any = null
  const RETRY_WAITS = [5000, 15000, 30000]   // 429 backoff
  // /history paginates by pageOffset (NOT nextToken — docs were wrong). Real response shape:
  // { events, pageSize, pageOffset, maxPageNumber, totalRecords }. pageOffset is a 0-based page
  // index; loop until we reach maxPageNumber (read from page 0). 200-page cap is a safety stop.
  let maxPageNumber = 0
  pages:
  for (let pageOffset = 0; pageOffset <= maxPageNumber && pageOffset < 200; pageOffset++) {
    const body: any = { eventTypes, fromDate: fromMs, toDate: toMs, count: 200, pageOffset, sort: { direction: 'ASC', key: 'DATE' } }

    let res: Response | null = null
    let lastErrText = ''
    for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
      res = await fetch(`${AMAZON_ADS_BASE}/history`, { method: 'POST', headers: h, body: JSON.stringify(body) })
      if (res.status !== 429) break
      lastErrText = await res.text().catch(() => '')
      const wait = RETRY_WAITS[attempt]
      if (wait == null) break   // out of retries
      console.log(`[sync] history page ${pageOffset} throttled (attempt ${attempt + 1}), retry in ${wait / 1000}s`)
      await new Promise(r => setTimeout(r, wait))
    }
    // Amazon's support team requires the request id (x-amzn-RequestId / x-amz-request-id)
    // to investigate empty-200 responses. Capture it on every page.
    const reqId = res?.headers.get('x-amzn-RequestId') ?? res?.headers.get('x-amz-request-id') ?? null
    if (!res || !res.ok) {
      const t = res ? (res.status === 429 ? lastErrText : await res.text().catch(() => '')) : ''
      console.log(`[sync] history page ${pageOffset}: HTTP ${res?.status} requestId=${reqId} ${t.slice(0, 300)}`)
      if (pageOffset === 0) firstDiag = { status: res?.status ?? 0, requestId: reqId, error: t.slice(0, 800) }
      break pages
    }
    const data = await res.json()
    const events: any[] = data.events ?? []
    if (pageOffset === 0) {
      maxPageNumber = data.maxPageNumber ?? 0
      // totalRecords is the real field (D-017); totalResults kept as fallback for older response shapes.
      firstDiag = { status: 200, requestId: reqId, count: events.length, totalRecords: data.totalRecords ?? data.totalResults ?? null, maxPageNumber, sampleEvent: events[0] ?? null }
    }
    all.push(...events)
    if (!events.length) break
  }

  // Diagnostics to logs only (no sync_logs row — keeps Sync History UI clean).
  console.log(`[sync] history diag: from=${new Date(fromMs).toISOString()} to=${new Date(toMs).toISOString()} fetched=${all.length} firstDiag=${JSON.stringify(firstDiag)}`)

  const rows = all.map(ev => mapHistoryEvent(ev, numericPid)).filter(Boolean)
  if (rows.length) {
    // Chunk upserts to stay well within payload limits.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500)
      const { error } = await db.from('change_events')
        .upsert(chunk, { onConflict: 'profile_id,entity_type,entity_id,field,event_ts', ignoreDuplicates: true })
      if (error) console.log(`[sync] change_events upsert: ${error.message}`)
    }
  }
  console.log(`[sync] change-history: fetched ${all.length}, mapped ${rows.length} (from ${new Date(fromMs).toISOString()})`)
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { profile_id, triggered_by = 'manual', history_only = false } = await req.json()
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // history_only mode: run ONLY the change-history ingest (no reports, no in-progress guard).
    // Used for isolated testing + on-demand backfill without competing for Amazon's rate bucket.
    if (history_only) {
      const { data: prof, error: e } = await db.from('amazon_profiles')
        .select('profile_id, access_token_enc, refresh_token_enc, token_expires_at')
        .eq('profile_id', profile_id).single()
      if (e || !prof) throw new Error(`Profile not found: ${e?.message}`)
      let tk = await decryptToken(prof.access_token_enc)
      if (new Date(prof.token_expires_at) <= new Date()) {
        const r = await refreshAccessToken(await decryptToken(prof.refresh_token_enc))
        tk = r.accessToken
        await db.from('amazon_profiles').update({ access_token_enc: await encryptToken(tk), token_expires_at: r.expiresAt.toISOString() }).eq('profile_id', profile_id)
      }
      // Lightweight capture: campaign/ad-group snapshots + change-history API + snapshot-diff.
      // No report creation (so no heavy rate usage) — used for testing + on-demand change refresh.
      await Promise.allSettled([
        syncCampaignStates(tk, String(prof.profile_id), db, prof.profile_id).catch(e => console.log(`[sync] states (history_only): ${e}`)),
        syncChangeHistory(tk, String(prof.profile_id), db, prof.profile_id).catch(e => console.log(`[sync] history (history_only): ${e}`)),
      ])
      // RETIRED 2026-07-02: snapshot-diff — Change History API is now the sole source (see sync-poll note).
      // try { await db.rpc('diff_snapshots_to_change_events', { p_profile: prof.profile_id }) } catch (e) { console.log(`[sync] diff (history_only): ${e}`) }
      return new Response(JSON.stringify({ success: true, mode: 'history_only' }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // Guard: reject if a fresh sync is already in progress (prevents 429 storms + 504 timeouts).
    // 'creating' = sync-profile is still submitting reports; stale after 3 min (edge fn timeout).
    // 'reports_pending' / 'running' / 'downloading' = waiting for Amazon; stale after 30 min.
    const [{ data: pendingCreating }, { data: pendingActive }] = await Promise.all([
      db.from('sync_logs').select('id, started_at').eq('profile_id', profile_id)
        .eq('status', 'creating').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('sync_logs').select('id, started_at').eq('profile_id', profile_id)
        .in('status', ['reports_pending', 'running', 'downloading']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const creatingAge = pendingCreating ? (Date.now() - new Date(pendingCreating.started_at).getTime()) / 60000 : Infinity
    const activeAge   = pendingActive   ? (Date.now() - new Date(pendingActive.started_at).getTime())   / 60000 : Infinity
    if (creatingAge < 3 || activeAge < 30) {
      return new Response(JSON.stringify({ success: false, error: 'Sync already in progress' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Manual sync: 60 days (2 batches). Auto/scheduled: 30 days (1 batch) to avoid pg_cron timeout.
    const isManual = triggered_by === 'manual'
    const batches = isManual
      ? [
          { startDate: dateStr(60), endDate: dateStr(31) },
          { startDate: dateStr(30), endDate: dateStr(1)  },
        ]
      : [{ startDate: dateStr(30), endDate: dateStr(1) }]

    // Load profile + refresh token if needed
    const { data: profile, error: pErr } = await db.from('amazon_profiles')
      .select('profile_id, access_token_enc, refresh_token_enc, token_expires_at')
      .eq('profile_id', profile_id).single()
    if (pErr || !profile) throw new Error(`Profile not found: ${pErr?.message}`)

    let token = await decryptToken(profile.access_token_enc)
    if (new Date(profile.token_expires_at) <= new Date()) {
      console.log('[sync] Refreshing token...')
      const r = await refreshAccessToken(await decryptToken(profile.refresh_token_enc))
      token = r.accessToken
      await db.from('amazon_profiles').update({ access_token_enc: await encryptToken(token), token_expires_at: r.expiresAt.toISOString() }).eq('profile_id', profile_id)
    }

    const pid = String(profile.profile_id)

    // Snapshot current campaign states + negative keywords + ingest change history — non-fatal if any fails.
    await Promise.allSettled([
      syncCampaignStates(token, pid, db, profile.profile_id).catch(e => console.log(`[sync] campaign-states skipped: ${e}`)),
      syncNegativeKeywords(token, pid, db, profile.profile_id).catch(e => console.log(`[sync] negative-keywords skipped: ${e}`)),
      syncChangeHistory(token, pid, db, profile.profile_id).catch(e => console.log(`[sync] change-history skipped: ${e}`)),
    ])

    // Column definitions
    const SP_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','topOfSearchImpressionShare','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    // SP v3: targeting expression text field is 'targeting' (not 'targetingText' which is the SB/v2 name)
    const SP_KW   = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','targeting','topOfSearchImpressionShare','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    // SP_ST: include both 'searchTerm' (customer query) and 'targeting' (keyword/ASIN expression that matched)
    const SP_ST   = ['date','campaignId','adGroupId','keywordId','matchType','targeting','searchTerm','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    // SP ad-group perf (groupBy adGroup): campaignId NOT allowed at this grain — resolved via sp_ad_groups
    const SP_AG    = ['date','adGroupId','adGroupName','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    // SP placement perf (groupBy campaignPlacement): placementClassification = Top of Search / Detail Page / Other
    const SP_PLACE = ['date','campaignId','placementClassification','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    // SB spend/clicks report — sales columns not supported at campaign level
    // sales/purchases/unitsSold = click-attributed (v3). Verifying these are valid + populated for sbCampaigns.
    const SB_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','sales','purchases','unitsSold']
    // SB_KW: sales columns not supported by sbTargeting in v3 — media metrics only.
    // SB keyword text: 'keywordText' (not 'keyword' which is SP-specific). 'targetingText' for ASIN/product target rows.
    const SB_KW   = ['date','campaignId','adGroupId','keywordId','keywordText','matchType','adKeywordStatus','keywordBid','targetingText','topOfSearchImpressionShare','impressions','clicks','cost']
    const SB_ST   = ['date','campaignId','adGroupId','searchTerm','matchType','keywordId','impressions','clicks','cost','purchases','sales','unitsSold']
    // sbPurchasedProduct: separate report for SB sales (groupBy purchasedAsin is the ONLY allowed value)
    const SB_ATTR = ['date','campaignId','sales14d','orders14d']
    // SB placement perf (sbCampaignPlacement, groupBy campaignPlacement) — probed 2026-07-02, accepted.
    // SB uses click-attributed sales/purchases/unitsSold (no 14d suffix).
    const SB_PLACE = ['date','campaignId','placementClassification','impressions','clicks','cost','purchases','sales','unitsSold']
    // SD campaign report — purchases14d/sales14d not supported; spend/traffic only
    const SD_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost']

    const logIds: number[] = []

    for (let i = 0; i < batches.length; i++) {
      if (i > 0) {
        await new Promise(r => setTimeout(r, 3000))
        // Re-read token from DB — a concurrent invocation may have refreshed it, revoking ours
        const { data: freshProfile } = await db.from('amazon_profiles')
          .select('access_token_enc, refresh_token_enc, token_expires_at')
          .eq('profile_id', profile_id).single()
        if (freshProfile) {
          token = await decryptToken(freshProfile.access_token_enc)
          if (new Date(freshProfile.token_expires_at) <= new Date()) {
            const r = await refreshAccessToken(await decryptToken(freshProfile.refresh_token_enc))
            token = r.accessToken
            await db.from('amazon_profiles').update({ access_token_enc: await encryptToken(token), token_expires_at: r.expiresAt.toISOString() }).eq('profile_id', profile_id)
          }
        }
      }
      const { startDate, endDate } = batches[i]
      console.log(`[sync] Creating SP reports for ${startDate} → ${endDate}...`)
      // maxRetries=0 for SP — fail fast. SP is almost never throttled; a null ID just
      // means 0 records for that report this batch, which is recoverable on next sync.
      const [spCamp, spKw, spSt] = await Promise.all([
        createReport(token, pid, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMP, startDate, endDate, undefined, 0),
        createReport(token, pid, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KW,   startDate, endDate, undefined, 0),
        createReport(token, pid, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_ST,   startDate, endDate, undefined, 0),
      ])

      // Insert log entry immediately after SP — visible in sync history within seconds.
      // Status starts as 'creating' so pg_cron sync-poll ignores it until all SB/SD IDs are patched.
      // SB/SD report IDs will be patched in below, then status flipped to 'reports_pending'.
      const { data: log } = await db.from('sync_logs').insert({
        profile_id, triggered_by,
        status: 'creating',
        started_at: new Date().toISOString(),
        date_range_start: startDate,
        date_range_end: endDate,
        report_ids: { spCamp, spKw, spSt, startDate, endDate },
      }).select('id').single()
      if (log?.id) logIds.push(log.id)

      // 5s gap between SP and SB is sufficient — sequential SB submission keeps rate low.
      await new Promise(r => setTimeout(r, 5000))
      console.log(`[sync] Creating SB reports for ${startDate} → ${endDate}...`)

      let sbAttr: string | null
      let sbCamp: string | null
      let sbKw:   string | null
      let sbSt:   string | null

      if (i === 0) {
        // Batch 1: sbAttr FIRST — rate-limit bucket freshest at start.
        // maxRetries=1 for sbAttr only (one 15s retry). All others: maxRetries=0 (fail fast).
        // Old code used maxRetries=3 (15+30+60s) for sbCamp/sbKw/sbSt — that alone could timeout.
        sbAttr = await createReport(token, pid, 'SB Attr Purch', 'SPONSORED_BRANDS', 'sbPurchasedProduct', ['purchasedAsin'], SB_ATTR, startDate, endDate, undefined, 1)
        await new Promise(r => setTimeout(r, 3000))
        // sbCamp is NON-optional (its absence = Partial). One retry guards against transient 429.
        sbCamp = await createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS', 'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate, undefined, 1)
        await new Promise(r => setTimeout(r, 5000))
        sbKw   = await createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS', 'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate, undefined, 0)
        await new Promise(r => setTimeout(r, 5000))
        sbSt   = await createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS', 'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate, undefined, 0)
      } else {
        // Batch 2: sbAttr LAST. sbCamp gets one retry (NON-optional → its absence = Partial).
        sbCamp = await createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS', 'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate, undefined, 1)
        await new Promise(r => setTimeout(r, 5000))
        sbKw   = await createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS', 'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate, undefined, 0)
        await new Promise(r => setTimeout(r, 5000))
        sbSt   = await createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS', 'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate, undefined, 0)
        await new Promise(r => setTimeout(r, 5000))
        sbAttr = await createReport(token, pid, 'SB Attr Purch', 'SPONSORED_BRANDS', 'sbPurchasedProduct', ['purchasedAsin'], SB_ATTR, startDate, endDate, undefined, 0)
      }

      await new Promise(r => setTimeout(r, 3000))
      console.log(`[sync] Creating SD reports for ${startDate} → ${endDate}...`)
      const [sdCamp] = await Promise.all([
        createReport(token, pid, 'SD Campaigns', 'SPONSORED_DISPLAY', 'sdCampaigns', ['campaign'], SD_CAMP, startDate, endDate, undefined, 0),
      ])

      // SP ad-group + placement perf — OPTIONAL, created LAST so they never pressure the
      // critical SP/SB report creations (avoids throttling sbCamp → Partial). Sequential, fail-fast.
      await new Promise(r => setTimeout(r, 3000))
      const spAg    = await createReport(token, pid, 'SP Ad Groups', 'SPONSORED_PRODUCTS', 'spCampaigns', ['adGroup'],           SP_AG,    startDate, endDate, undefined, 0)
      await new Promise(r => setTimeout(r, 3000))
      const spPlace = await createReport(token, pid, 'SP Placements','SPONSORED_PRODUCTS', 'spCampaigns', ['campaignPlacement'], SP_PLACE, startDate, endDate, undefined, 0)
      await new Promise(r => setTimeout(r, 3000))
      const sbPlace = await createReport(token, pid, 'SB Placements','SPONSORED_BRANDS', 'sbCampaignPlacement', ['campaignPlacement'], SB_PLACE, startDate, endDate, undefined, 0)

      // Patch in the SB/SD report IDs and flip to 'reports_pending' — pg_cron can now pick this up.
      if (log?.id) {
        await db.from('sync_logs').update({
          status: 'reports_pending',
          report_ids: { spCamp, spKw, spSt, spAg, spPlace, sbPlace, sbCamp, sbKw, sbSt, sbAttr, sdCamp, startDate, endDate },
        }).eq('id', log.id)
      }
    }

    console.log(`[sync] All reports submitted. Log IDs: ${logIds.join(', ')}`)

    return new Response(JSON.stringify({ success: true, log_ids: logIds, message: 'Reports submitted. Data will be ready in 10–15 minutes.' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync] Error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
