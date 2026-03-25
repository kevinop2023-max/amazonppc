// Supabase Edge Function: sync-profile
// Pro plan: 400s wall clock — enough for full sync in one call.
// Returns 200 immediately, runs sync in background via EdgeRuntime.waitUntil().
// All 6 reports created + polled in parallel.

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

// ── Column definitions ───────────────────────────────────────────────────────

const SP_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_KW   = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SP_ST   = ['date','campaignId','adGroupId','keywordId','matchType','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
const SB_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost']
const SB_KW   = ['date','campaignId','adGroupId','keywordId','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost']
const SB_ST   = ['date','campaignId','adGroupId','impressions','clicks','cost']

// ── Crypto ───────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function toCents(v: any) { return v ? Math.round(Number(v) * 100) : 0 }
function n(v: any) { return Number(v ?? 0) }
function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

async function downloadAndParse(url: string): Promise<any[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const ds = new DecompressionStream('gzip')
  const w = ds.writable.getWriter(), r = ds.readable.getReader()
  w.write(new Uint8Array(await res.arrayBuffer())); w.close()
  const chunks: Uint8Array[] = []
  for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value) }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length }
  return JSON.parse(new TextDecoder().decode(out))
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshToken(refreshToken: string) {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: AMAZON_LWA_CLIENT_ID, client_secret: AMAZON_LWA_CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`Token refresh: ${res.status} ${await res.text()}`)
  const d = await res.json()
  return { accessToken: d.access_token, expiresAt: new Date(Date.now() + (d.expires_in - 60) * 1000) }
}

// ── Amazon API ────────────────────────────────────────────────────────────────

function headers(token: string, pid: string) {
  return { Authorization: `Bearer ${token}`, 'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID, 'Amazon-Advertising-API-Scope': pid }
}

async function createReport(token: string, pid: string, name: string, adProduct: string, typeId: string, groupBy: string[], cols: string[], start: string, end: string): Promise<string | null> {
  try {
    const res = await fetch(`${AMAZON_ADS_BASE}/reporting/reports`, {
      method: 'POST',
      headers: { ...headers(token, pid), 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
      body: JSON.stringify({ name, startDate: start, endDate: end, configuration: { adProduct, groupBy, columns: cols, reportTypeId: typeId, timeUnit: 'DAILY', format: 'GZIP_JSON' } }),
    })
    const text = await res.text()
    if (!res.ok) {
      const dup = text.match(/duplicate of\s*[:\s]+([a-f0-9-]{36})/i)
      if (dup) { console.log(`[sync] Reuse ${name} → ${dup[1]}`); return dup[1] }
      console.error(`[sync] Skip ${name}: ${res.status} ${text}`); return null
    }
    const d = JSON.parse(text)
    console.log(`[sync] Created ${name} → ${d.reportId}`); return d.reportId
  } catch (e) { console.error(`[sync] Skip ${name}: ${e}`); return null }
}

async function waitForReport(token: string, pid: string, name: string, reportId: string): Promise<string | null> {
  // Poll every 5s, up to 70 attempts = 350s (within 400s Pro limit)
  for (let i = 0; i < 70; i++) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const res = await fetch(`${AMAZON_ADS_BASE}/reporting/reports/${reportId}`, { headers: headers(token, pid) })
      if (!res.ok) { console.error(`[sync] Poll error ${name}: ${res.status}`); continue }
      const s = await res.json()
      console.log(`[sync] ${name}: ${s.status} (${i + 1})`)
      if (s.status === 'COMPLETED') {
        const dlRes = await fetch(`${AMAZON_ADS_BASE}/reporting/reports/${reportId}/download`, { headers: headers(token, pid) })
        if (!dlRes.ok) { console.error(`[sync] Download URL error ${name}`); return null }
        const dl = await dlRes.json()
        return dl.url ?? dl.location ?? dl.downloadUrl ?? null
      }
      if (s.status === 'FAILED') { console.error(`[sync] ${name} FAILED`); return null }
    } catch (e) { console.error(`[sync] Poll error ${name}: ${e}`) }
  }
  console.error(`[sync] ${name} timed out`); return null
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsert(db: any, table: string, records: any[], conflict: string) {
  if (!records.length) return 0
  const { error } = await db.from(table).upsert(records, { onConflict: conflict })
  if (error) throw new Error(`${table}: ${error.message}`)
  return records.length
}

async function upsertAll(db: any, profileId: number, data: Record<string, any[]>) {
  let total = 0
  const sp = data.spCamp ?? []
  total += await upsert(db, 'sp_campaigns', sp.map((r: any) => ({ profile_id: profileId, campaign_id: n(r.campaignId), date: r.date, campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled', daily_budget_cents: toCents(r.campaignBudgetAmount), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) })), 'profile_id,campaign_id,date')

  const skw = (data.spKw ?? []).filter((r: any) => r.keywordId)
  total += await upsert(db, 'sp_keywords', skw.map((r: any) => ({ profile_id: profileId, keyword_id: n(r.keywordId), ad_group_id: n(r.adGroupId), campaign_id: n(r.campaignId), date: r.date, keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) })), 'profile_id,keyword_id,date')

  const sst = data.spSt ?? []
  total += await upsert(db, 'sp_search_terms', sst.map((r: any) => ({ profile_id: profileId, campaign_id: n(r.campaignId), ad_group_id: n(r.adGroupId), date: r.date, customer_search_term: r.targeting ?? '', keyword_id: r.keywordId ? n(r.keywordId) : null, match_type: r.matchType?.toLowerCase() ?? null, impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) })), 'profile_id,campaign_id,ad_group_id,customer_search_term,date')

  const sb = data.sbCamp ?? []
  total += await upsert(db, 'sb_campaigns', sb.map((r: any) => ({ profile_id: profileId, campaign_id: n(r.campaignId), date: r.date, campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled', daily_budget_cents: toCents(r.campaignBudgetAmount), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: 0, orders: 0, units: 0 })), 'profile_id,campaign_id,date')

  const sbkw = (data.sbKw ?? []).filter((r: any) => r.keywordId)
  total += await upsert(db, 'sb_keywords', sbkw.map((r: any) => ({ profile_id: profileId, keyword_id: n(r.keywordId), campaign_id: n(r.campaignId), ad_group_id: r.adGroupId ? n(r.adGroupId) : null, date: r.date, keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) })), 'profile_id,keyword_id,date')

  const sbst = data.sbSt ?? []
  total += await upsert(db, 'sb_search_terms', sbst.map((r: any) => ({ profile_id: profileId, campaign_id: n(r.campaignId), ad_group_id: r.adGroupId ? n(r.adGroupId) : null, date: r.date, customer_search_term: r.targeting ?? r.searchTerm ?? r.query ?? '', impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: 0, orders: 0, units: 0 })), 'profile_id,campaign_id,ad_group_id,customer_search_term,date')

  return total
}

// ── Main sync ─────────────────────────────────────────────────────────────────

async function runSync(profileId: number, logId: string, db: any, startDate: string, endDate: string) {
  try {
    const { data: profile } = await db.from('amazon_profiles')
      .select('profile_id, access_token_enc, refresh_token_enc, token_expires_at')
      .eq('profile_id', profileId).single()
    if (!profile) throw new Error('Profile not found')

    let token = await decryptToken(profile.access_token_enc)
    if (new Date(profile.token_expires_at) <= new Date()) {
      console.log('[sync] Refreshing token...')
      const r = await refreshToken(await decryptToken(profile.refresh_token_enc))
      token = r.accessToken
      await db.from('amazon_profiles').update({ access_token_enc: await encryptToken(token), token_expires_at: r.expiresAt.toISOString() }).eq('profile_id', profileId)
    }

    const pid = String(profile.profile_id)

    // Step 1: Create all reports in parallel
    console.log('[sync] Creating all reports...')
    const [spCampId, spKwId, spStId, sbCampId, sbKwId, sbStId] = await Promise.all([
      createReport(token, pid, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMP, startDate, endDate),
      createReport(token, pid, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KW,   startDate, endDate),
      createReport(token, pid, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_ST,   startDate, endDate),
      createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS',   'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate),
      createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS',   'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate),
      createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS',   'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate),
    ])

    // Step 2: Poll all in parallel
    console.log('[sync] Polling all reports...')
    const [spCampUrl, spKwUrl, spStUrl, sbCampUrl, sbKwUrl, sbStUrl] = await Promise.all([
      spCampId ? waitForReport(token, pid, 'SP Campaigns', spCampId) : Promise.resolve(null),
      spKwId   ? waitForReport(token, pid, 'SP Keywords',  spKwId)   : Promise.resolve(null),
      spStId   ? waitForReport(token, pid, 'SP Terms',     spStId)   : Promise.resolve(null),
      sbCampId ? waitForReport(token, pid, 'SB Campaigns', sbCampId) : Promise.resolve(null),
      sbKwId   ? waitForReport(token, pid, 'SB Keywords',  sbKwId)   : Promise.resolve(null),
      sbStId   ? waitForReport(token, pid, 'SB Terms',     sbStId)   : Promise.resolve(null),
    ])

    // Step 3: Download all in parallel
    console.log('[sync] Downloading...')
    const [spCamp, spKw, spSt, sbCamp, sbKw, sbSt] = await Promise.all([
      spCampUrl ? downloadAndParse(spCampUrl) : Promise.resolve([]),
      spKwUrl   ? downloadAndParse(spKwUrl)   : Promise.resolve([]),
      spStUrl   ? downloadAndParse(spStUrl)   : Promise.resolve([]),
      sbCampUrl ? downloadAndParse(sbCampUrl) : Promise.resolve([]),
      sbKwUrl   ? downloadAndParse(sbKwUrl)   : Promise.resolve([]),
      sbStUrl   ? downloadAndParse(sbStUrl)   : Promise.resolve([]),
    ])

    // Step 4: Upsert
    console.log('[sync] Upserting...')
    const total = await upsertAll(db, profileId, { spCamp, spKw, spSt, sbCamp, sbKw, sbSt })

    await db.from('amazon_profiles').update({ last_sync_at: new Date().toISOString() }).eq('profile_id', profileId)
    await db.from('sync_logs').update({ status: 'success', completed_at: new Date().toISOString(), records_upserted: total }).eq('id', logId)
    console.log(`[sync] Done — ${total} records`)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync] Error:', msg)
    await db.from('sync_logs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: msg }).eq('id', logId)
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { profile_id, triggered_by = 'manual' } = await req.json()
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const endDate = dateStr(1), startDate = dateStr(4)

    const { data: log } = await db.from('sync_logs').insert({
      profile_id, triggered_by, status: 'running',
      started_at: new Date().toISOString(),
      date_range_start: startDate, date_range_end: endDate,
    }).select().single()

    // Run sync in background — respond immediately
    const syncPromise = runSync(profile_id, log.id, db, startDate, endDate)
    ;(globalThis as any).EdgeRuntime?.waitUntil(syncPromise) ?? syncPromise

    return new Response(JSON.stringify({ success: true, log_id: log.id, message: 'Sync started' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
