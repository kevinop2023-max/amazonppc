// Supabase Edge Function: sync-profile
// Deno runtime — handles Amazon Ads API report sync (no Vercel 10s timeout limit)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AMAZON_LWA_CLIENT_ID = Deno.env.get('AMAZON_LWA_CLIENT_ID')!
const AMAZON_LWA_CLIENT_SECRET = Deno.env.get('AMAZON_LWA_CLIENT_SECRET')!
const TOKEN_ENCRYPTION_KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY')!

const AMAZON_ADS_BASE = 'https://advertising-api.amazon.com'
const LWA_TOKEN_URL   = 'https://api.amazon.com/auth/o2/token'

// ── Report column definitions ───────────────────────────────────────────────

const SP_CAMPAIGN_COLS   = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_ADGROUP_COLS    = ['date','campaignId','adGroupId','adGroupName','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_KEYWORD_COLS    = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_SEARCHTERM_COLS = ['date','campaignId','adGroupId','keywordId','matchType','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_CAMPAIGN_COLS   = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_KEYWORD_COLS    = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_SEARCHTERM_COLS = ['date','campaignId','adGroupId','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']

// ── Crypto helpers (Web Crypto API — Deno compatible) ───────────────────────

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return arr
}

async function decryptToken(encrypted: string): Promise<string> {
  // Format: iv(24 hex chars = 12 bytes) + authTag(32 hex chars = 16 bytes) + ciphertext(hex)
  const ivHex      = encrypted.slice(0, 24)
  const authTagHex = encrypted.slice(24, 56)
  const cipherHex  = encrypted.slice(56)

  const keyBytes  = hexToBytes(TOKEN_ENCRYPTION_KEY)
  const iv        = hexToBytes(ivHex)
  const authTag   = hexToBytes(authTagHex)
  const cipherBuf = hexToBytes(cipherHex)

  // AES-GCM ciphertext and auth tag are concatenated for Web Crypto
  const combined = new Uint8Array(cipherBuf.length + authTag.length)
  combined.set(cipherBuf)
  combined.set(authTag, cipherBuf.length)

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  )
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 }, key, combined
  )
  return new TextDecoder().decode(decrypted)
}

async function encryptToken(plaintext: string): Promise<string> {
  const keyBytes    = hexToBytes(TOKEN_ENCRYPTION_KEY)
  const iv          = crypto.getRandomValues(new Uint8Array(12))
  const plaintextBuf = new TextEncoder().encode(plaintext)

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 }, key, plaintextBuf
  )

  const encryptedArr = new Uint8Array(encrypted)
  const ciphertext  = encryptedArr.slice(0, -16)
  const authTag     = encryptedArr.slice(-16)

  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return toHex(iv) + toHex(authTag) + toHex(ciphertext)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  const compressed   = await res.arrayBuffer()
  const ds           = new DecompressionStream('gzip')
  const writer       = ds.writable.getWriter()
  const reader       = ds.readable.getReader()
  writer.write(new Uint8Array(compressed))
  writer.close()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const totalLen    = chunks.reduce((s, c) => s + c.length, 0)
  const combined    = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder().decode(combined))
}

// ── Token refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     AMAZON_LWA_CLIENT_ID,
      client_secret: AMAZON_LWA_CLIENT_SECRET,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return {
    accessToken: data.access_token,
    expiresAt:   new Date(Date.now() + (data.expires_in - 60) * 1000),
  }
}

// ── Amazon Ads API calls ─────────────────────────────────────────────────────

async function amazonGet(accessToken: string, profileId: string, path: string): Promise<any> {
  const res = await fetch(`${AMAZON_ADS_BASE}${path}`, {
    headers: {
      'Authorization':        `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
      'Amazon-Advertising-API-Scope':    profileId,
      'Content-Type':         'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Amazon Ads API GET ${path} failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function amazonPost(accessToken: string, profileId: string, path: string, body: any): Promise<any> {
  const res = await fetch(`${AMAZON_ADS_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Authorization':        `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
      'Amazon-Advertising-API-Scope':    profileId,
      'Content-Type':         'application/vnd.createasyncreportrequest.v3+json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Amazon Ads API POST ${path} failed: ${res.status} ${text}`)
  }
  return res.json()
}

// ── Report creation + polling ────────────────────────────────────────────────

async function createAndWaitReport(
  accessToken: string,
  amazonProfileId: string,
  name: string,
  adProduct: 'SPONSORED_PRODUCTS' | 'SPONSORED_BRANDS',
  reportTypeId: string,
  groupBy: string[],
  columns: string[],
  startDate: string,
  endDate: string,
): Promise<any[]> {
  console.log(`[sync] Creating report: ${name}`)

  let reportId: string
  try {
    const result = await amazonPost(accessToken, amazonProfileId, '/reporting/reports', {
      name,
      startDate,
      endDate,
      configuration: { adProduct, groupBy, columns, reportTypeId, timeUnit: 'DAILY', format: 'GZIP_JSON' },
    })
    reportId = result.reportId
    console.log(`[sync] Report created: ${name} → ${reportId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const dupMatch = msg.match(/duplicate of\s*[:\s]+([a-f0-9-]{36})/i)
    if (dupMatch) {
      reportId = dupMatch[1]
      console.log(`[sync] Reusing duplicate report: ${name} → ${reportId}`)
    } else {
      throw new Error(`[${name}] ${msg}`)
    }
  }

  // Poll until complete (max ~120 attempts × 5s = 10 min)
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await amazonGet(accessToken, amazonProfileId, `/reporting/reports/${reportId}`)
    console.log(`[sync] ${name} status: ${status.status} (attempt ${attempt + 1})`)

    if (status.status === 'COMPLETED') {
      const dlData = await amazonGet(accessToken, amazonProfileId, `/reporting/reports/${reportId}/download`)
      const url = dlData.url ?? dlData.location ?? dlData.downloadUrl
      if (!url) throw new Error(`[${name}] No download URL in response: ${JSON.stringify(dlData)}`)
      return downloadAndParse(url)
    }
    if (status.status === 'FAILED') {
      throw new Error(`[${name}] Report failed: ${JSON.stringify(status)}`)
    }
  }
  throw new Error(`[${name}] Report timed out after polling`)
}

// ── Upsert helpers ───────────────────────────────────────────────────────────

async function upsertSpCampaigns(db: any, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id: profileId, campaign_id: Number(r.campaignId), date: r.date,
    campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled',
    daily_budget_cents: toCents(r.campaignBudgetAmount),
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  const { error } = await db.from('sp_campaigns').upsert(records, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sp_campaigns upsert: ${error.message}`)
  return records.length
}

async function upsertSpAdGroups(db: any, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id: profileId, ad_group_id: Number(r.adGroupId), campaign_id: Number(r.campaignId),
    date: r.date, ad_group_name: r.adGroupName ?? '',
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  const { error } = await db.from('sp_ad_groups').upsert(records, { onConflict: 'profile_id,ad_group_id,date' })
  if (error) throw new Error(`sp_ad_groups upsert: ${error.message}`)
  return records.length
}

async function upsertSpKeywords(db: any, profileId: number, rows: any[]) {
  const records = rows.filter(r => r.keywordId).map(r => ({
    profile_id: profileId, keyword_id: Number(r.keywordId),
    ad_group_id: Number(r.adGroupId), campaign_id: Number(r.campaignId), date: r.date,
    keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(),
    state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid),
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  if (!records.length) return 0
  const { error } = await db.from('sp_keywords').upsert(records, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sp_keywords upsert: ${error.message}`)
  return records.length
}

async function upsertSpSearchTerms(db: any, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id: profileId, campaign_id: Number(r.campaignId), ad_group_id: Number(r.adGroupId),
    date: r.date, customer_search_term: r.targeting ?? '',
    keyword_id: r.keywordId ? Number(r.keywordId) : null,
    match_type: r.matchType ? r.matchType.toLowerCase() : null,
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  if (!records.length) return 0
  const { error } = await db.from('sp_search_terms').upsert(records, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sp_search_terms upsert: ${error.message}`)
  return records.length
}

async function upsertSbCampaigns(db: any, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id: profileId, campaign_id: Number(r.campaignId), date: r.date,
    campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled',
    daily_budget_cents: toCents(r.campaignBudgetAmount),
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  const { error } = await db.from('sb_campaigns').upsert(records, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sb_campaigns upsert: ${error.message}`)
  return records.length
}

async function upsertSbKeywords(db: any, profileId: number, rows: any[]) {
  const records = rows.filter(r => r.keywordId).map(r => ({
    profile_id: profileId, keyword_id: Number(r.keywordId),
    campaign_id: Number(r.campaignId), ad_group_id: r.adGroupId ? Number(r.adGroupId) : null,
    date: r.date, keyword_text: r.keyword ?? '',
    match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled',
    bid_cents: toCents(r.keywordBid),
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  if (!records.length) return 0
  const { error } = await db.from('sb_keywords').upsert(records, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sb_keywords upsert: ${error.message}`)
  return records.length
}

async function upsertSbSearchTerms(db: any, profileId: number, rows: any[]) {
  const records = rows.map(r => ({
    profile_id: profileId, campaign_id: Number(r.campaignId),
    ad_group_id: r.adGroupId ? Number(r.adGroupId) : null,
    date: r.date, customer_search_term: r.targeting ?? '',
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d),
    orders: Number(r.purchases14d ?? 0), units: Number(r.unitsSoldClicks14d ?? 0),
  }))
  if (!records.length) return 0
  const { error } = await db.from('sb_search_terms').upsert(records, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sb_search_terms upsert: ${error.message}`)
  return records.length
}

// ── Main handler ─────────────────────────────────────────────────────────────

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

    const db      = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const endDate   = dateStr(1)
    const startDate = dateStr(4)

    // Create sync log
    const { data: log } = await db
      .from('sync_logs')
      .insert({ profile_id, triggered_by, status: 'running', started_at: new Date().toISOString(), date_range_start: startDate, date_range_end: endDate })
      .select()
      .single()
    const logId = log?.id

    try {
      // Load profile + decrypt tokens
      const { data: profile, error: profileErr } = await db
        .from('amazon_profiles')
        .select('amazon_profile_id, access_token_enc, refresh_token_enc, token_expires_at')
        .eq('profile_id', profile_id)
        .single()

      if (profileErr || !profile) throw new Error(`Profile not found: ${profileErr?.message}`)

      const refreshToken   = await decryptToken(profile.refresh_token_enc)
      let   accessToken    = await decryptToken(profile.access_token_enc)
      const tokenExpiresAt = new Date(profile.token_expires_at)

      // Refresh access token if expired
      if (tokenExpiresAt <= new Date()) {
        console.log('[sync] Refreshing access token...')
        const refreshed = await refreshAccessToken(refreshToken)
        accessToken = refreshed.accessToken
        const newEncAccess = await encryptToken(accessToken)
        await db.from('amazon_profiles').update({
          access_token_enc: newEncAccess,
          token_expires_at: refreshed.expiresAt.toISOString(),
        }).eq('profile_id', profile_id)
      }

      const amazonProfileId = String(profile.amazon_profile_id)
      let totalRecords = 0

      // Run all 7 reports sequentially
      const spCampRows = await createAndWaitReport(accessToken, amazonProfileId, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMPAIGN_COLS,   startDate, endDate)
      const spAdgRows  = await createAndWaitReport(accessToken, amazonProfileId, 'SP AdGroups',  'SPONSORED_PRODUCTS', 'spAdGroups',   ['adGroup'],    SP_ADGROUP_COLS,    startDate, endDate)
      const spKwRows   = await createAndWaitReport(accessToken, amazonProfileId, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KEYWORD_COLS,    startDate, endDate)
      const spStRows   = await createAndWaitReport(accessToken, amazonProfileId, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_SEARCHTERM_COLS, startDate, endDate)
      const sbCampRows = await createAndWaitReport(accessToken, amazonProfileId, 'SB Campaigns', 'SPONSORED_BRANDS',   'sbCampaigns',  ['campaign'],   SB_CAMPAIGN_COLS,   startDate, endDate).catch(() => [])
      const sbKwRows   = await createAndWaitReport(accessToken, amazonProfileId, 'SB Keywords',  'SPONSORED_BRANDS',   'sbTargeting',  ['targeting'],  SB_KEYWORD_COLS,    startDate, endDate).catch(() => [])
      const sbStRows   = await createAndWaitReport(accessToken, amazonProfileId, 'SB Terms',     'SPONSORED_BRANDS',   'sbSearchTerm', ['searchTerm'], SB_SEARCHTERM_COLS, startDate, endDate).catch(() => [])

      // Upsert all data
      totalRecords += await upsertSpCampaigns(db,   profile_id, spCampRows)
      totalRecords += await upsertSpAdGroups(db,    profile_id, spAdgRows)
      totalRecords += await upsertSpKeywords(db,    profile_id, spKwRows)
      totalRecords += await upsertSpSearchTerms(db, profile_id, spStRows)
      totalRecords += await upsertSbCampaigns(db,   profile_id, sbCampRows)
      totalRecords += await upsertSbKeywords(db,    profile_id, sbKwRows)
      totalRecords += await upsertSbSearchTerms(db, profile_id, sbStRows)

      // Update last_sync_at
      await db.from('amazon_profiles').update({ last_sync_at: new Date().toISOString() }).eq('profile_id', profile_id)

      // Mark success
      if (logId) {
        await db.from('sync_logs').update({
          status: 'success', completed_at: new Date().toISOString(), records_upserted: totalRecords,
        }).eq('id', logId)
      }

      return new Response(JSON.stringify({ success: true, records_upserted: totalRecords }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (logId) {
        await db.from('sync_logs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: msg }).eq('id', logId)
      }
      return new Response(JSON.stringify({ success: false, error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
