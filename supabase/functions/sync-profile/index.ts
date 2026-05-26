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
        const wait = RETRY_WAITS[attempt - 1] ?? 60000
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

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { profile_id, triggered_by = 'manual' } = await req.json()
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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

    // Column definitions
    const SP_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    const SP_KW   = ['date','campaignId','adGroupId','keywordId','keyword','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    const SP_ST   = ['date','campaignId','adGroupId','keywordId','matchType','targeting','impressions','clicks','cost','purchases14d','sales14d','unitsSoldClicks14d']
    // SB spend/clicks report — sales columns not supported at campaign level
    const SB_CAMP = ['date','campaignId','campaignName','campaignStatus','campaignBudgetAmount','impressions','clicks','cost']
    // SB_KW: sales columns not supported by sbTargeting in v3 — media metrics only.
    // NOTE: 'keyword' (text) is not a valid column for sbTargeting — Amazon rejects the request.
    // Keyword text is unavailable in the SB reporting API; only keywordId is returned.
    const SB_KW   = ['date','campaignId','adGroupId','keywordId','matchType','adKeywordStatus','keywordBid','impressions','clicks','cost']
    const SB_ST   = ['date','campaignId','adGroupId','targeting','impressions','clicks','cost']
    // sbPurchasedProduct: separate report for SB sales (groupBy purchasedAsin is the ONLY allowed value)
    const SB_ATTR = ['date','campaignId','sales14d','orders14d']
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
      const [spCamp, spKw, spSt] = await Promise.all([
        createReport(token, pid, 'SP Campaigns', 'SPONSORED_PRODUCTS', 'spCampaigns',  ['campaign'],   SP_CAMP, startDate, endDate),
        createReport(token, pid, 'SP Keywords',  'SPONSORED_PRODUCTS', 'spTargeting',  ['targeting'],  SP_KW,   startDate, endDate),
        createReport(token, pid, 'SP Terms',     'SPONSORED_PRODUCTS', 'spSearchTerm', ['searchTerm'], SP_ST,   startDate, endDate),
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

      // Wait between SP and SB — SB has a tighter rate limit than SP
      await new Promise(r => setTimeout(r, 15000))
      console.log(`[sync] Creating SB reports for ${startDate} → ${endDate}...`)

      let sbAttr: string | null
      let sbCamp: string | null
      let sbKw:   string | null
      let sbSt:   string | null

      if (i === 0) {
        // Batch 1: sbAttr FIRST — bucket is freshest, best chance of success
        sbAttr = await createReport(token, pid, 'SB Attr Purch', 'SPONSORED_BRANDS', 'sbPurchasedProduct', ['purchasedAsin'], SB_ATTR, startDate, endDate)
        await new Promise(r => setTimeout(r, 5000))
        sbCamp = await createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS', 'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate)
        await new Promise(r => setTimeout(r, 8000))
        sbKw   = await createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS', 'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate)
        await new Promise(r => setTimeout(r, 8000))
        sbSt   = await createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS', 'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate)
      } else {
        // Batch 2: sbAttr LAST — maximises the gap since batch 1's sbAttr (~90s vs ~60s rate limit).
        // 0 retries on sbAttr: if throttled, accept null (partial) rather than risk a 150s timeout.
        sbCamp = await createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS', 'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate)
        await new Promise(r => setTimeout(r, 8000))
        sbKw   = await createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS', 'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate)
        await new Promise(r => setTimeout(r, 8000))
        sbSt   = await createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS', 'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate)
        await new Promise(r => setTimeout(r, 8000))
        sbAttr = await createReport(token, pid, 'SB Attr Purch', 'SPONSORED_BRANDS', 'sbPurchasedProduct', ['purchasedAsin'], SB_ATTR, startDate, endDate, undefined, 0)
      }

      await new Promise(r => setTimeout(r, 5000))
      console.log(`[sync] Creating SD reports for ${startDate} → ${endDate}...`)
      const [sdCamp] = await Promise.all([
        createReport(token, pid, 'SD Campaigns', 'SPONSORED_DISPLAY', 'sdCampaigns', ['campaign'], SD_CAMP, startDate, endDate),
      ])

      // Patch in the SB/SD report IDs and flip to 'reports_pending' — pg_cron can now pick this up.
      if (log?.id) {
        await db.from('sync_logs').update({
          status: 'reports_pending',
          report_ids: { spCamp, spKw, spSt, sbCamp, sbKw, sbSt, sbAttr, sdCamp, startDate, endDate },
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
