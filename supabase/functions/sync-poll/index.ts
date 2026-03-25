// Phase 2: Poll Amazon report statuses. Called repeatedly by the client every 15s.
// One round of polling per call — no loops. Fast execution, well within 150s limit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AMAZON_LWA_CLIENT_ID      = Deno.env.get('AMAZON_LWA_CLIENT_ID')!
const TOKEN_ENCRYPTION_KEY      = Deno.env.get('TOKEN_ENCRYPTION_KEY')!

const AMAZON_ADS_BASE = 'https://advertising-api.amazon.com'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Crypto ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return arr
}

async function decryptToken(encrypted: string): Promise<string> {
  const iv = hexToBytes(encrypted.slice(0, 24))
  const authTag = hexToBytes(encrypted.slice(24, 56))
  const cipher = hexToBytes(encrypted.slice(56))
  const combined = new Uint8Array(cipher.length + authTag.length)
  combined.set(cipher); combined.set(authTag, cipher.length)
  const key = await crypto.subtle.importKey('raw', hexToBytes(TOKEN_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, combined))
}

// ── Amazon API helpers ────────────────────────────────────────────────────────

function adsHeaders(token: string, profileId: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': AMAZON_LWA_CLIENT_ID,
    'Amazon-Advertising-API-Scope': profileId,
  }
}

async function getReportStatus(token: string, profileId: string, reportId: string) {
  const res = await fetch(`${AMAZON_ADS_BASE}/reporting/reports/${reportId}`, { headers: adsHeaders(token, profileId) })
  if (!res.ok) throw new Error(`Status check failed: ${res.status} ${await res.text()}`)
  return res.json()
  // Note: when COMPLETED, Amazon includes a `url` field directly in this response
}

async function downloadAndParse(url: string): Promise<any[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()
  writer.write(new Uint8Array(await res.arrayBuffer())); writer.close()
  const chunks: Uint8Array[] = []
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value) }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length }
  return JSON.parse(new TextDecoder().decode(out))
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

function toCents(v: any) { return v ? Math.round(Number(v) * 100) : 0 }
function n(v: any) { return Number(v ?? 0) }

async function upsertSpCampaigns(db: any, pid: number, rows: any[]) {
  if (!rows.length) return 0
  const r = rows.map(r => ({ profile_id: pid, campaign_id: n(r.campaignId), date: r.date, campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled', daily_budget_cents: toCents(r.campaignBudgetAmount), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) }))
  const { error } = await db.from('sp_campaigns').upsert(r, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sp_campaigns: ${error.message}`)
  return r.length
}

async function upsertSpKeywords(db: any, pid: number, rows: any[]) {
  const r = rows.filter(r => r.keywordId).map(r => ({ profile_id: pid, keyword_id: n(r.keywordId), ad_group_id: n(r.adGroupId), campaign_id: n(r.campaignId), date: r.date, keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) }))
  if (!r.length) return 0
  const { error } = await db.from('sp_keywords').upsert(r, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sp_keywords: ${error.message}`)
  return r.length
}

async function upsertSpSearchTerms(db: any, pid: number, rows: any[]) {
  if (!rows.length) return 0
  const r = rows.map(r => ({ profile_id: pid, campaign_id: n(r.campaignId), ad_group_id: n(r.adGroupId), date: r.date, customer_search_term: r.targeting ?? '', keyword_id: r.keywordId ? n(r.keywordId) : null, match_type: r.matchType?.toLowerCase() ?? null, impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) }))
  const { error } = await db.from('sp_search_terms').upsert(r, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sp_search_terms: ${error.message}`)
  return r.length
}

async function upsertSbCampaigns(db: any, pid: number, rows: any[]) {
  if (!rows.length) return 0
  const r = rows.map(r => ({ profile_id: pid, campaign_id: n(r.campaignId), date: r.date, campaign_name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled', daily_budget_cents: toCents(r.campaignBudgetAmount), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) }))
  const { error } = await db.from('sb_campaigns').upsert(r, { onConflict: 'profile_id,campaign_id,date' })
  if (error) throw new Error(`sb_campaigns: ${error.message}`)
  return r.length
}

async function upsertSbKeywords(db: any, pid: number, rows: any[]) {
  const r = rows.filter(r => r.keywordId).map(r => ({ profile_id: pid, keyword_id: n(r.keywordId), campaign_id: n(r.campaignId), ad_group_id: r.adGroupId ? n(r.adGroupId) : null, date: r.date, keyword_text: r.keyword ?? '', match_type: (r.matchType ?? 'broad').toLowerCase(), state: r.adKeywordStatus ?? 'enabled', bid_cents: toCents(r.keywordBid), impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) }))
  if (!r.length) return 0
  const { error } = await db.from('sb_keywords').upsert(r, { onConflict: 'profile_id,keyword_id,date' })
  if (error) throw new Error(`sb_keywords: ${error.message}`)
  return r.length
}

async function upsertSbSearchTerms(db: any, pid: number, rows: any[]) {
  if (!rows.length) return 0
  const r = rows.map(r => ({ profile_id: pid, campaign_id: n(r.campaignId), ad_group_id: r.adGroupId ? n(r.adGroupId) : null, date: r.date, customer_search_term: r.targeting ?? '', impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) }))
  const { error } = await db.from('sb_search_terms').upsert(r, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sb_search_terms: ${error.message}`)
  return r.length
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { log_id, profile_id } = await req.json().catch(() => ({}))

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Find the pending sync log
    let query = db.from('sync_logs').select('*').eq('status', 'reports_pending').order('started_at', { ascending: false }).limit(1)
    if (log_id) query = db.from('sync_logs').select('*').eq('id', log_id).single() as any

    const { data: log, error: logErr } = await (log_id
      ? db.from('sync_logs').select('*').eq('id', log_id).single()
      : db.from('sync_logs').select('*').eq('status', 'reports_pending').order('started_at', { ascending: false }).limit(1).maybeSingle()
    )

    if (logErr || !log) {
      return new Response(JSON.stringify({ status: 'no_pending', message: 'No pending sync found' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (log.status !== 'reports_pending') {
      return new Response(JSON.stringify({ status: log.status, records_upserted: log.records_upserted }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const ids = log.report_ids as any
    const pid = log.profile_id

    // Load access token
    const { data: profile } = await db.from('amazon_profiles').select('profile_id, access_token_enc, token_expires_at').eq('profile_id', pid).single()
    if (!profile) throw new Error('Profile not found')
    const token = await decryptToken(profile.access_token_enc)
    const amazonPid = String(profile.profile_id)

    // Check all report statuses in parallel (single round, no loop)
    const reportEntries = Object.entries(ids).filter(([k]) => !['startDate','endDate'].includes(k) && ids[k])

    const statuses = await Promise.all(
      reportEntries.map(async ([name, reportId]) => {
        try {
          const s = await getReportStatus(token, amazonPid, reportId as string)
          console.log(`[poll] ${name}: ${s.status}`)
          // Amazon includes the download URL directly in the status response when COMPLETED
          const url = s.url ?? s.location ?? s.downloadUrl ?? null
          return { name, reportId, status: s.status, url }
        } catch (e) {
          console.error(`[poll] ${name} status error: ${e}`)
          return { name, reportId, status: 'FAILED', url: null }
        }
      })
    )

    const allDone   = statuses.every(s => s.status === 'COMPLETED' || s.status === 'FAILED')
    const anyFailed = statuses.some(s => s.status === 'FAILED')
    const completed = statuses.filter(s => s.status === 'COMPLETED')

    if (!allDone) {
      const pending = statuses.filter(s => s.status !== 'COMPLETED').map(s => s.name)
      console.log(`[poll] Still pending: ${pending.join(', ')}`)
      return new Response(JSON.stringify({ status: 'reports_pending', pending }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // All done — download and upsert
    console.log(`[poll] All reports ready. Downloading ${completed.length} reports...`)

    const nameMap: Record<string, string> = { spCamp: 'SP Campaigns', spKw: 'SP Keywords', spSt: 'SP Terms', sbCamp: 'SB Campaigns', sbKw: 'SB Keywords', sbSt: 'SB Terms' }
    const dataMap: Record<string, any[]> = {}

    await Promise.all(
      completed.map(async ({ name, reportId, url: statusUrl }) => {
        try {
          // Use URL from status response; fall back to download endpoint if missing
          let url = statusUrl
          if (!url) {
            const res = await fetch(`${AMAZON_ADS_BASE}/reporting/reports/${reportId}/download`, {
              headers: adsHeaders(token, amazonPid),
              redirect: 'manual',
            })
            url = res.headers.get('location') ?? null
            if (!url && res.ok) {
              const d = await res.json()
              url = d.url ?? d.location ?? d.downloadUrl
            }
          }
          if (!url) throw new Error('No download URL available')
          dataMap[name] = await downloadAndParse(url)
          console.log(`[poll] Downloaded ${nameMap[name] ?? name}: ${dataMap[name].length} rows`)
        } catch (e) {
          console.error(`[poll] Download failed ${name}: ${e}`)
          dataMap[name] = []
        }
      })
    )

    let total = 0
    total += await upsertSpCampaigns(db, pid, dataMap['spCamp'] ?? [])
    total += await upsertSpKeywords(db,   pid, dataMap['spKw']   ?? [])
    total += await upsertSpSearchTerms(db,pid, dataMap['spSt']   ?? [])
    total += await upsertSbCampaigns(db,  pid, dataMap['sbCamp'] ?? [])
    total += await upsertSbKeywords(db,   pid, dataMap['sbKw']   ?? [])
    total += await upsertSbSearchTerms(db,pid, dataMap['sbSt']   ?? [])

    await db.from('amazon_profiles').update({ last_sync_at: new Date().toISOString() }).eq('profile_id', pid)
    await db.from('sync_logs').update({ status: anyFailed ? 'partial' : 'success', completed_at: new Date().toISOString(), records_upserted: total }).eq('id', log.id)

    console.log(`[poll] Done — ${total} records upserted`)
    return new Response(JSON.stringify({ status: 'success', records_upserted: total }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[poll] Error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
