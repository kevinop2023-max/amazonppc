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

  const [sp, sb, sd] = await Promise.all([
    listAll('/v2/sp/campaigns').catch(e => { console.log(`[sync] sp-list: ${e}`); return [] }),
    listAll('/sb/campaigns').catch(e    => { console.log(`[sync] sb-list: ${e}`); return [] }),
    listAll('/sd/campaigns').catch(e    => { console.log(`[sync] sd-list: ${e}`); return [] }),
  ])

  const upsert = async (table: string, rows: object[]) => {
    if (!rows.length) return
    // ignoreDuplicates: true → DO NOTHING on conflict, so existing perf data is not overwritten with 0s
    const { error } = await (db as any).from(table).upsert(rows, { onConflict: 'profile_id,campaign_id,date', ignoreDuplicates: true })
    if (error) console.log(`[sync] ${table} state-upsert: ${error.message}`)
    else console.log(`[sync] campaign-states ${table}: ${rows.length} rows`)
  }

  const state = (v: any) => String(v ?? 'enabled').toLowerCase()
  const budget = (v: any) => v ? Math.round(Number(v) * 100) : 0

  await Promise.all([
    upsert('sp_campaigns', sp.map(c => ({
      profile_id: numericPid, campaign_id: Number(c.campaignId), date: today,
      campaign_name: c.name ?? '', state: state(c.state),
      daily_budget_cents: budget(c.dailyBudget),
      impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0, units: 0,
    }))),
    upsert('sb_campaigns', sb.map(c => ({
      profile_id: numericPid, campaign_id: Number(c.campaignId), date: today,
      campaign_name: c.name ?? '', state: state(c.state),
      daily_budget_cents: budget(c.dailyBudget),
      impressions: 0, clicks: 0, spend_cents: 0,
    }))),
    upsert('sd_campaigns', sd.map(c => ({
      profile_id: numericPid, campaign_id: Number(c.campaignId), date: today,
      campaign_name: c.name ?? '', state: state(c.state),
      daily_budget_cents: budget(c.dailyBudget),
      impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0, units: 0,
    }))),
  ])
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

    // Snapshot current campaign states (enabled/paused/archived) from the campaign
    // list API. Non-fatal — if it fails, the rest of the sync continues normally.
    try {
      await syncCampaignStates(token, pid, db, profile.profile_id)
    } catch (e) {
      console.log(`[sync] campaign-states skipped: ${e}`)
    }

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
    const SB_ST   = ['date','campaignId','adGroupId','searchTerm','query','targeting','impressions','clicks','cost']
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
        sbCamp = await createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS', 'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate, undefined, 0)
        await new Promise(r => setTimeout(r, 5000))
        sbKw   = await createReport(token, pid, 'SB Keywords',  'SPONSORED_BRANDS', 'sbTargeting',  ['targeting'],  SB_KW,   startDate, endDate, undefined, 0)
        await new Promise(r => setTimeout(r, 5000))
        sbSt   = await createReport(token, pid, 'SB Terms',     'SPONSORED_BRANDS', 'sbSearchTerm', ['searchTerm'], SB_ST,   startDate, endDate, undefined, 0)
      } else {
        // Batch 2: sbAttr LAST. All maxRetries=0 — no retries to stay within 150s total budget.
        sbCamp = await createReport(token, pid, 'SB Campaigns', 'SPONSORED_BRANDS', 'sbCampaigns',  ['campaign'],   SB_CAMP, startDate, endDate, undefined, 0)
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
