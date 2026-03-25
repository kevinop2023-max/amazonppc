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

async function createReport(token: string, pid: string, name: string, adProduct: string, typeId: string, groupBy: string[], cols: string[], start: string, end: string): Promise<string | null> {
  try {
    const res = await fetch(`${AMAZON_ADS_BASE}/reporting/reports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
        'Amazon-Advertising-API-Scope': pid,
        'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
      },
      body: JSON.stringify({ name, startDate: start, endDate: end, configuration: { adProduct, groupBy, columns: cols, reportTypeId: typeId, timeUnit: 'DAILY', format: 'GZIP_JSON' } }),
    })
    const text = await res.text()
    if (!res.ok) {
      const dup = text.match(/duplicate of\s*[:\s]+([a-f0-9-]{36})/i)
      if (dup) { console.log(`[sync] Reuse ${name} → ${dup[1]}`); return dup[1] }
      console.error(`[sync] Skip ${name}: ${res.status} ${text.slice(0, 200)}`); return null
    }
    const d = JSON.parse(text)
    console.log(`[sync] Created ${name} → ${d.reportId}`); return d.reportId
  } catch (e) { console.error(`[sync] Skip ${name}: ${e}`); return null }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { profile_id, triggered_by = 'manual' } = await req.json()
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const endDate = dateStr(1), startDate = dateStr(4)

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

    // Column definitions
    const SP_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    const SP_KW   = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    const SP_ST   = ['date','campaignId','adGroupId','keywordId','matchType','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    const SB_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost']
    const SB_KW   = ['date','campaignId','adGroupId','keywordId','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost']
    const SB_ST   = ['date','campaignId','adGroupId','impressions','clicks','cost']

    // Create all reports in parallel (~5s)
    console.log('[sync] Creating all reports...')
    const [spCamp, spKw, spSt, sbCamp, sbKw, sbSt] = await Promise.all([
      createReport(token, pid, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMP, startDate, endDate),
      createReport(token, pid, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KW,   startDate, endDate),
      createReport(token, pid, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_ST,   startDate, endDate),
      createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS',   'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate),
      createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS',   'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate),
      createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS',   'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate),
    ])

    // Save report IDs + metadata to sync_log
    const reportIds = { spCamp, spKw, spSt, sbCamp, sbKw, sbSt, startDate, endDate }
    const { data: log } = await db.from('sync_logs').insert({
      profile_id, triggered_by,
      status: 'reports_pending',
      started_at: new Date().toISOString(),
      date_range_start: startDate,
      date_range_end: endDate,
      report_ids: reportIds,
    }).select('id').single()

    console.log(`[sync] All reports submitted. Log ID: ${log?.id}. pg_cron will poll every minute.`)

    return new Response(JSON.stringify({ success: true, log_id: log?.id, message: 'Reports submitted. Data will be ready in 5–10 minutes.' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync] Error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
