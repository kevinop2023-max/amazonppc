// Supabase Edge Function: sync-profile
// Returns 200 immediately, runs sync in background via EdgeRuntime.waitUntil()
// All 7 reports created + polled in parallel to stay within 150s wall-clock limit

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AMAZON_LWA_CLIENT_ID     = Deno.env.get('AMAZON_LWA_CLIENT_ID')!
const AMAZON_LWA_CLIENT_SECRET = Deno.env.get('AMAZON_LWA_CLIENT_SECRET')!
const TOKEN_ENCRYPTION_KEY     = Deno.env.get('TOKEN_ENCRYPTION_KEY')!

const AMAZON_ADS_BASE = 'https://advertising-api.amazon.com'
const LWA_TOKEN_URL   = 'https://api.amazon.com/auth/o2/token'

// ── Report column definitions ────────────────────────────────────────────────

const SP_CAMPAIGN_COLS   = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_ADGROUP_COLS    = ['date','campaignId','adGroupId','adGroupName','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_KEYWORD_COLS    = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_SEARCHTERM_COLS = ['date','campaignId','adGroupId','keywordId','matchType','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_CAMPAIGN_COLS   = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_KEYWORD_COLS    = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_SEARCHTERM_COLS = ['date','campaignId','adGroupId','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']

// ── Crypto helpers ───────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return arr
}

async function decryptToken(encrypted: string): Promise<string> {
  const iv       = hexToBytes(encrypted.slice(0, 24))
  const authTag  = hexToBytes(encrypted.slice(24, 56))
  const cipher   = hexToBytes(encrypted.slice(56))
  const combined = new Uint8Array(cipher.length + authTag.length)
  combined.set(cipher); combined.set(authTag, cipher.length)
  const key = await crypto.subtle.importKey('raw', hexToBytes(TOKEN_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['decrypt'])
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, combined)
  return new TextDecoder().decode(dec)
}

async function encryptToken(plaintext: string): Promise<string> {
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', hexToBytes(TOKEN_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['encrypt'])
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plaintext)))
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return toHex(iv) + toHex(enc.slice(-16)) + toHex(enc.slice(0, -16))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toCents(val: string | number | null | undefined): number {
  if (!val) return 0
  return Math.round(Number(val) * 100)
}

function dateStr(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

async function downloadAndParse(url: string): Promise<any[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const ds     = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()
  writer.write(new Uint8Array(await res.arrayBuffer()))
  writer.close()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length }
  return JSON.parse(new TextDecoder().decode(out))
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: AMAZON_LWA_CLIENT_ID, client_secret: AMAZON_LWA_CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in - 60) * 1000) }
}

// ── Amazon API ───────────────────────────────────────────────────────────────

function adsHeaders(accessToken: string, profileId: string) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
    'Amazon-Advertising-API-Scope': profileId,
    'Content-Type': 'application/json',
  }
}

async function adsGet(accessToken: string, profileId: string, path: string): Promise<any> {
  const res = await fetch(`${AMAZON_ADS_BASE}${path}`, { headers: adsHeaders(accessToken, profileId) })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function adsPost(accessToken: string, profileId: string, path: string, body: any): Promise<any> {
  const res = await fetch(`${AMAZON_ADS_BASE}${path}`, {
    method: 'POST',
    headers: { ...adsHeaders(accessToken, profileId), 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Report: create one report and return its ID ───────────────────────────────

async function createReport(
  accessToken: string, amazonProfileId: string, name: string,
  adProduct: 'SPONSORED_PRODUCTS' | 'SPONSORED_BRANDS',
  reportTypeId: string, groupBy: string[], columns: string[],
  startDate: string, endDate: string,
): Promise<string> {
  try {
    const result = await adsPost(accessToken, amazonProfileId, '/reporting/reports', {
      name, startDate, endDate,
      configuration: { adProduct, groupBy, columns, reportTypeId, timeUnit: 'DAILY', format: 'GZIP_JSON' },
    })
    console.log(`[sync] Created report ${name} → ${result.reportId}`)
    return result.reportId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const dup = msg.match(/duplicate of\s*[:\s]+([a-f0-9-]{36})/i)
    if (dup) { console.log(`[sync] Reuse duplicate ${name} → ${dup[1]}`); return dup[1] }
    throw new Error(`[${name}] ${msg}`)
  }
}

// ── Poll a single report until COMPLETED, return download URL ─────────────────

async function waitReport(accessToken: string, amazonProfileId: string, name: string, reportId: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const s = await adsGet(accessToken, amazonProfileId, `/reporting/reports/${reportId}`)
    console.log(`[sync] ${name}: ${s.status} (${i + 1})`)
    if (s.status === 'COMPLETED') {
      const dl = await adsGet(accessToken, amazonProfileId, `/reporting/reports/${reportId}/download`)
      const url = dl.url ?? dl.location ?? dl.downloadUrl
      if (!url) throw new Error(`[${name}] No download URL: ${JSON.stringify(dl)}`)
      return url
    }
    if (s.status === 'FAILED') throw new Error(`[${name}] Report failed: ${JSON.stringify(s)}`)
  }
  throw new Error(`[${name}] Timed out polling`)
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertSpCampaigns(db: any, profileId: number, rows: any[]) {
  if (!rows.length) return 0
  const records = rows.map(r => ({ profile_id: profileId, campaign_id: Number(r.campaignId), date: r.date, campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled', daily_budget_cents: toCents(r.campaignBudgetAmount), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  const { error } = await db.from('sp_campaigns').upsert(records, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sp_campaigns: ${error.message}`)
  return records.length
}

async function upsertSpAdGroups(db: any, profileId: number, rows: any[]) {
  if (!rows.length) return 0
  const records = rows.map(r => ({ profile_id: profileId, ad_group_id: Number(r.adGroupId), campaign_id: Number(r.campaignId), date: r.date, ad_group_name: r.adGroupName ?? '', impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  const { error } = await db.from('sp_ad_groups').upsert(records, { onConflict: 'profile_id,ad_group_id,date' })
  if (error) throw new Error(`sp_ad_groups: ${error.message}`)
  return records.length
}

async function upsertSpKeywords(db: any, profileId: number, rows: any[]) {
  const records = rows.filter(r => r.keywordId).map(r => ({ profile_id: profileId, keyword_id: Number(r.keywordId), ad_group_id: Number(r.adGroupId), campaign_id: Number(r.campaignId), date: r.date, keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  if (!records.length) return 0
  const { error } = await db.from('sp_keywords').upsert(records, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sp_keywords: ${error.message}`)
  return records.length
}

async function upsertSpSearchTerms(db: any, profileId: number, rows: any[]) {
  if (!rows.length) return 0
  const records = rows.map(r => ({ profile_id: profileId, campaign_id: Number(r.campaignId), ad_group_id: Number(r.adGroupId), date: r.date, customer_search_term: r.targeting ?? '', keyword_id: r.keywordId ? Number(r.keywordId) : null, match_type: r.matchType ? r.matchType.toLowerCase() : null, impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  const { error } = await db.from('sp_search_terms').upsert(records, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sp_search_terms: ${error.message}`)
  return records.length
}

async function upsertSbCampaigns(db: any, profileId: number, rows: any[]) {
  if (!rows.length) return 0
  const records = rows.map(r => ({ profile_id: profileId, campaign_id: Number(r.campaignId), date: r.date, campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled', daily_budget_cents: toCents(r.campaignBudgetAmount), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  const { error } = await db.from('sb_campaigns').upsert(records, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sb_campaigns: ${error.message}`)
  return records.length
}

async function upsertSbKeywords(db: any, profileId: number, rows: any[]) {
  const records = rows.filter(r => r.keywordId).map(r => ({ profile_id: profileId, keyword_id: Number(r.keywordId), campaign_id: Number(r.campaignId), ad_group_id: r.adGroupId ? Number(r.adGroupId) : null, date: r.date, keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  if (!records.length) return 0
  const { error } = await db.from('sb_keywords').upsert(records, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sb_keywords: ${error.message}`)
  return records.length
}

async function upsertSbSearchTerms(db: any, profileId: number, rows: any[]) {
  if (!rows.length) return 0
  const records = rows.map(r => ({ profile_id: profileId, campaign_id: Number(r.campaignId), ad_group_id: r.adGroupId ? Number(r.adGroupId) : null, date: r.date, customer_search_term: r.targeting ?? '', impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0) }))
  const { error } = await db.from('sb_search_terms').upsert(records, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sb_search_terms: ${error.message}`)
  return records.length
}

// ── Main sync logic (runs in background) ─────────────────────────────────────

async function runSync(profileId: number, logId: string | null, db: any, startDate: string, endDate: string) {
  try {
    // Load profile and decrypt tokens
    const { data: profile, error: profileErr } = await db
      .from('amazon_profiles')
      .select('amazon_profile_id, access_token_enc, refresh_token_enc, token_expires_at')
      .eq('profile_id', profileId)
      .single()

    if (profileErr || !profile) throw new Error(`Profile not found: ${profileErr?.message}`)

    let accessToken = await decryptToken(profile.access_token_enc)
    const refreshToken = await decryptToken(profile.refresh_token_enc)

    if (new Date(profile.token_expires_at) <= new Date()) {
      console.log('[sync] Refreshing token...')
      const r = await refreshAccessToken(refreshToken)
      accessToken = r.accessToken
      await db.from('amazon_profiles').update({
        access_token_enc: await encryptToken(accessToken),
        token_expires_at: r.expiresAt.toISOString(),
      }).eq('profile_id', profileId)
    }

    const pid = String(profile.amazon_profile_id)

    // ── Step 1: Create all 7 reports in parallel ──────────────────────────────
    console.log('[sync] Creating all reports in parallel...')
    const [spCampId, spAdgId, spKwId, spStId, sbCampId, sbKwId, sbStId] = await Promise.all([
      createReport(accessToken, pid, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMPAIGN_COLS,   startDate, endDate),
      createReport(accessToken, pid, 'SP AdGroups',  'SPONSORED_PRODUCTS', 'spAdGroups',   ['adGroup'],    SP_ADGROUP_COLS,    startDate, endDate),
      createReport(accessToken, pid, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KEYWORD_COLS,    startDate, endDate),
      createReport(accessToken, pid, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_SEARCHTERM_COLS, startDate, endDate),
      createReport(accessToken, pid, 'SB Campaigns', 'SPONSORED_BRANDS',   'sbCampaigns',  ['campaign'],   SB_CAMPAIGN_COLS,   startDate, endDate).catch(() => null),
      createReport(accessToken, pid, 'SB Keywords',  'SPONSORED_BRANDS',   'sbTargeting',  ['targeting'],  SB_KEYWORD_COLS,    startDate, endDate).catch(() => null),
      createReport(accessToken, pid, 'SB Terms',     'SPONSORED_BRANDS',   'sbSearchTerm', ['searchTerm'], SB_SEARCHTERM_COLS, startDate, endDate).catch(() => null),
    ])

    // ── Step 2: Poll all reports in parallel ──────────────────────────────────
    console.log('[sync] Polling all reports in parallel...')
    const [spCampUrl, spAdgUrl, spKwUrl, spStUrl, sbCampUrl, sbKwUrl, sbStUrl] = await Promise.all([
      waitReport(accessToken, pid, 'SP Campaigns', spCampId),
      waitReport(accessToken, pid, 'SP AdGroups',  spAdgId),
      waitReport(accessToken, pid, 'SP Keywords',  spKwId),
      waitReport(accessToken, pid, 'SP Terms',     spStId),
      sbCampId ? waitReport(accessToken, pid, 'SB Campaigns', sbCampId).catch(() => null) : Promise.resolve(null),
      sbKwId   ? waitReport(accessToken, pid, 'SB Keywords',  sbKwId).catch(() => null)   : Promise.resolve(null),
      sbStId   ? waitReport(accessToken, pid, 'SB Terms',     sbStId).catch(() => null)   : Promise.resolve(null),
    ])

    // ── Step 3: Download all in parallel ──────────────────────────────────────
    console.log('[sync] Downloading all reports in parallel...')
    const [spCampRows, spAdgRows, spKwRows, spStRows, sbCampRows, sbKwRows, sbStRows] = await Promise.all([
      downloadAndParse(spCampUrl),
      downloadAndParse(spAdgUrl),
      downloadAndParse(spKwUrl),
      downloadAndParse(spStUrl),
      sbCampUrl ? downloadAndParse(sbCampUrl).catch(() => []) : Promise.resolve([]),
      sbKwUrl   ? downloadAndParse(sbKwUrl).catch(() => [])   : Promise.resolve([]),
      sbStUrl   ? downloadAndParse(sbStUrl).catch(() => [])   : Promise.resolve([]),
    ])

    // ── Step 4: Upsert all ────────────────────────────────────────────────────
    console.log('[sync] Upserting data...')
    let total = 0
    total += await upsertSpCampaigns(db,   profileId, spCampRows)
    total += await upsertSpAdGroups(db,    profileId, spAdgRows)
    total += await upsertSpKeywords(db,    profileId, spKwRows)
    total += await upsertSpSearchTerms(db, profileId, spStRows)
    total += await upsertSbCampaigns(db,   profileId, sbCampRows)
    total += await upsertSbKeywords(db,    profileId, sbKwRows)
    total += await upsertSbSearchTerms(db, profileId, sbStRows)

    await db.from('amazon_profiles').update({ last_sync_at: new Date().toISOString() }).eq('profile_id', profileId)

    if (logId) await db.from('sync_logs').update({ status: 'success', completed_at: new Date().toISOString(), records_upserted: total }).eq('id', logId)
    console.log(`[sync] Done — ${total} records upserted`)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync] Error:', msg)
    if (logId) await db.from('sync_logs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: msg }).eq('id', logId)
  }
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }})
  }

  try {
    const { profile_id, triggered_by = 'manual' } = await req.json()
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id required' }), { status: 400 })

    const db        = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const endDate   = dateStr(1)
    const startDate = dateStr(4)

    // Create sync log entry
    const { data: log } = await db
      .from('sync_logs')
      .insert({ profile_id, triggered_by, status: 'running', started_at: new Date().toISOString(), date_range_start: startDate, date_range_end: endDate })
      .select()
      .single()

    // Run sync in background — response returns immediately
    // deno-lint-ignore no-explicit-any
    ;(globalThis as any).EdgeRuntime?.waitUntil(runSync(profile_id, log?.id ?? null, db, startDate, endDate))
      ?? runSync(profile_id, log?.id ?? null, db, startDate, endDate) // fallback for local testing

    return new Response(JSON.stringify({ success: true, message: 'Sync started', log_id: log?.id }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
