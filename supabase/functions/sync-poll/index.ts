// Phase 2: Poll Amazon report statuses. Called repeatedly by the client every 15s.
// One round of polling per call — no loops. Fast execution, well within 150s limit.

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

// ── Crypto ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return arr
}

async function encryptToken(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', hexToBytes(TOKEN_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['encrypt'])
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plain)))
  const h = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return h(iv) + h(enc.slice(-16)) + h(enc.slice(0, -16))
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

function parseJsonOrNdjson(text: string): any[] {
  const t = text.trim()
  if (t.startsWith('[')) return JSON.parse(t)
  if (!t) return []
  return t.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
}

async function downloadAndParse(url: string): Promise<any[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`S3 download failed: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  console.log(`[poll] Got ${bytes.length} bytes, magic=${bytes[0]?.toString(16)},${bytes[1]?.toString(16)}`)

  // Check gzip magic bytes (1f 8b). If fetch already decompressed it, skip decompression.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip')
    const w = ds.writable.getWriter()
    const r = ds.readable.getReader()
    w.write(bytes); w.close()
    const chunks: Uint8Array[] = []
    for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value) }
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
    let off = 0; for (const c of chunks) { out.set(c, off); off += c.length }
    return parseJsonOrNdjson(new TextDecoder().decode(out))
  }
  // Already decompressed by fetch — parse directly
  return parseJsonOrNdjson(new TextDecoder().decode(bytes))
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
  // Deduplicate: same search term can appear multiple times (multiple keywords match it)
  const map = new Map<string, any>()
  for (const r of rows) {
    const key = `${n(r.campaignId)}|${n(r.adGroupId)}|${r.date}|${r.targeting ?? ''}`
    const ex = map.get(key)
    if (ex) {
      ex.impressions += n(r.impressions); ex.clicks += n(r.clicks)
      ex.spend_cents += toCents(r.cost); ex.sales_cents += toCents(r.sales14d)
      ex.orders += n(r.purchases14d); ex.units += n(r.unitsSoldClicks14d)
    } else {
      map.set(key, { profile_id: pid, campaign_id: n(r.campaignId), ad_group_id: n(r.adGroupId), date: r.date, customer_search_term: r.targeting ?? '', keyword_id: r.keywordId ? n(r.keywordId) : null, match_type: r.matchType?.toLowerCase() ?? null, impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) })
    }
  }
  const deduped = [...map.values()]
  const { error } = await db.from('sp_search_terms').upsert(deduped, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sp_search_terms: ${error.message}`)
  return deduped.length
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
  const map = new Map<string, any>()
  for (const r of rows) {
    const adGrp = r.adGroupId ? n(r.adGroupId) : null
    const key = `${n(r.campaignId)}|${adGrp}|${r.date}|${r.targeting ?? ''}`
    const ex = map.get(key)
    if (ex) {
      ex.impressions += n(r.impressions); ex.clicks += n(r.clicks)
      ex.spend_cents += toCents(r.cost); ex.sales_cents += toCents(r.sales14d)
      ex.orders += n(r.purchases14d); ex.units += n(r.unitsSoldClicks14d)
    } else {
      map.set(key, { profile_id: pid, campaign_id: n(r.campaignId), ad_group_id: adGrp, date: r.date, customer_search_term: r.targeting ?? '', impressions: n(r.impressions), clicks: n(r.clicks), spend_cents: toCents(r.cost), sales_cents: toCents(r.sales14d), orders: n(r.purchases14d), units: n(r.unitsSoldClicks14d) })
    }
  }
  const deduped = [...map.values()]
  const { error } = await db.from('sb_search_terms').upsert(deduped, { onConflict: 'profile_id,campaign_id,ad_group_id,customer_search_term,date' })
  if (error) throw new Error(`sb_search_terms: ${error.message}`)
  return deduped.length
}

// Aggregate sbPurchasedProduct rows by campaign+date.
// UPDATEs existing sb_campaigns rows; INSERTs a $0-spend row when no match exists
// (sbPurchasedProduct uses PURCHASE date — campaign may have had no spend on that date).
async function updateSbCampaignSales(db: any, pid: number, rows: any[], sbCampRows: any[]) {
  if (!rows.length) return 0

  const nullCampRows = rows.filter(r => !r.campaignId || n(r.campaignId) === 0).length
  const totalSalesFromReport = rows.reduce((s: number, r: any) => s + toCents(r.sales14d), 0)
  console.log(`[poll] sbAttr: ${rows.length} rows, ${nullCampRows} null-campaignId, total sales=$${(totalSalesFromReport/100).toFixed(2)}`)

  // Build campaign name/state lookup from this batch's sbCamp data
  const nameMap = new Map<number, { name: string; state: string }>()
  for (const r of sbCampRows) {
    const cid = n(r.campaignId)
    if (cid && !nameMap.has(cid)) nameMap.set(cid, { name: r.campaignName ?? '', state: r.campaignStatus ?? 'enabled' })
  }

  // For any campaigns missing from sbCamp (had no spend this batch), look them up in the DB
  const unknownIds = [...new Set(rows.map((r: any) => n(r.campaignId)).filter((id: number) => id > 0 && !nameMap.has(id)))]
  if (unknownIds.length > 0) {
    const { data: dbRows } = await db.from('sb_campaigns')
      .select('campaign_id, campaign_name, state')
      .eq('profile_id', pid)
      .in('campaign_id', unknownIds)
      .limit(200)
    if (dbRows) {
      for (const r of dbRows) {
        if (!nameMap.has(r.campaign_id)) nameMap.set(r.campaign_id, { name: r.campaign_name ?? '', state: r.state ?? 'enabled' })
      }
    }
  }

  // Aggregate by campaign+date
  const map = new Map<string, { campaign_id: number; date: string; sales_cents: number; orders: number }>()
  for (const r of rows) {
    const key = `${n(r.campaignId)}|${r.date}`
    const ex = map.get(key)
    if (ex) {
      ex.sales_cents += toCents(r.sales14d)
      ex.orders      += n(r.orders14d)
    } else {
      map.set(key, { campaign_id: n(r.campaignId), date: r.date, sales_cents: toCents(r.sales14d), orders: n(r.orders14d) })
    }
  }
  console.log(`[poll] sbAttr: ${map.size} unique campaign+date keys`)

  let updated = 0, inserted = 0, errored = 0
  for (const v of map.values()) {
    if (v.campaign_id === 0) { errored++; continue }

    // Try UPDATE first (campaign had spend on this date)
    const { data: updatedRows, error: updateErr } = await db.from('sb_campaigns')
      .update({ sales_cents: v.sales_cents, orders: v.orders })
      .eq('profile_id', pid)
      .eq('campaign_id', v.campaign_id)
      .eq('date', v.date)
      .select('id')

    if (updateErr) {
      console.error(`[poll] sbAttr update error: ${updateErr.message}`)
      errored++
      continue
    }

    if (updatedRows && updatedRows.length > 0) {
      updated++
      continue
    }

    // No matching row — sbPurchasedProduct date is the purchase date, not click date.
    // Campaign had no spend on this date; insert a $0-spend row to capture the attribution.
    const info = nameMap.get(v.campaign_id)
    console.log(`[poll] sbAttr insert missing row: campaign_id=${v.campaign_id} date=${v.date} sales=$${(v.sales_cents/100).toFixed(2)} name="${info?.name ?? ''}"`)
    const { error: insertErr } = await db.from('sb_campaigns').insert({
      profile_id: pid,
      campaign_id: v.campaign_id,
      date: v.date,
      campaign_name: info?.name ?? '',
      state: info?.state ?? 'enabled',
      daily_budget_cents: null,
      impressions: 0,
      clicks: 0,
      spend_cents: 0,
      sales_cents: v.sales_cents,
      orders: v.orders,
      units: 0,
    })
    if (insertErr) {
      // Duplicate key = a concurrent call already inserted this row; fall back to UPDATE
      if (insertErr.message.includes('duplicate') || insertErr.message.includes('unique')) {
        const { error: retryErr } = await db.from('sb_campaigns')
          .update({ sales_cents: v.sales_cents, orders: v.orders })
          .eq('profile_id', pid).eq('campaign_id', v.campaign_id).eq('date', v.date)
        if (retryErr) { console.error(`[poll] sbAttr retry update error: ${retryErr.message}`); errored++ }
        else { inserted++; console.log(`[poll] sbAttr retry-update (concurrent): campaign_id=${v.campaign_id} date=${v.date}`) }
      } else {
        console.error(`[poll] sbAttr insert error: ${insertErr.message}`)
        errored++
      }
    } else inserted++
  }

  console.log(`[poll] sbAttr done: ${updated} updated, ${inserted} inserted, ${errored} errors`)
  return updated + inserted
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
      : db.from('sync_logs').select('*').in('status', ['reports_pending', 'downloading']).order('started_at', { ascending: false }).limit(1).maybeSingle()
    )

    if (logErr || !log) {
      return new Response(JSON.stringify({ status: 'no_pending', message: 'No pending sync found' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 'downloading' means a previous call claimed this log but timed out before finishing.
    // Reset it to 'reports_pending' so it gets reprocessed on the next poll.
    if (log.status === 'downloading') {
      await db.from('sync_logs').update({ status: 'reports_pending' }).eq('id', log.id)
      return new Response(JSON.stringify({ status: 'reports_pending', pending: ['reset'] }), {
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

    // Load access token, refresh if expired
    const { data: profile } = await db.from('amazon_profiles').select('profile_id, access_token_enc, refresh_token_enc, token_expires_at').eq('profile_id', pid).single()
    if (!profile) throw new Error('Profile not found')
    let token = await decryptToken(profile.access_token_enc)
    if (new Date(profile.token_expires_at) <= new Date()) {
      console.log('[poll] Refreshing token...')
      const r = await refreshAccessToken(await decryptToken(profile.refresh_token_enc))
      token = r.accessToken
      await db.from('amazon_profiles').update({ access_token_enc: await encryptToken(token), token_expires_at: r.expiresAt.toISOString() }).eq('profile_id', pid)
    }
    const amazonPid = String(profile.profile_id)

    // Check all report statuses in parallel (single round, no loop)
    const reportEntries = Object.entries(ids).filter(([k]) => !['startDate','endDate'].includes(k) && ids[k])

    const statuses = await Promise.all(
      reportEntries.map(async ([name, reportId]) => {
        try {
          const s = await getReportStatus(token, amazonPid, reportId as string)
          console.log(`[poll] ${name}: ${s.status} url=${s.url ?? s.location ?? s.downloadUrl ?? 'NONE'} keys=${Object.keys(s).join(',')}`)
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

    const nameMap: Record<string, string> = { spCamp: 'SP Campaigns', spKw: 'SP Keywords', spSt: 'SP Terms', sbCamp: 'SB Campaigns', sbKw: 'SB Keywords', sbSt: 'SB Terms', sbAttr: 'SB Attr Purchases' }
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
          console.log(`[poll] Downloading ${name} from ${url.slice(0, 80)}...`)
          dataMap[name] = await downloadAndParse(url)
          console.log(`[poll] Downloaded ${nameMap[name] ?? name}: ${dataMap[name].length} rows`)
        } catch (e) {
          console.error(`[poll] Download failed ${name}: ${e}`)
          dataMap[name] = []
        }
      })
    )

    let total = 0
    total += await upsertSpCampaigns(db,     pid, dataMap['spCamp'] ?? [])
    total += await upsertSpKeywords(db,       pid, dataMap['spKw']   ?? [])
    total += await upsertSpSearchTerms(db,    pid, dataMap['spSt']   ?? [])
    total += await upsertSbCampaigns(db,      pid, dataMap['sbCamp'] ?? [])
    total += await upsertSbKeywords(db,       pid, dataMap['sbKw']   ?? [])
    total += await upsertSbSearchTerms(db,    pid, dataMap['sbSt']   ?? [])
    // Log SB keyword sales totals — tells us if sbTargeting supports sales14d columns
    const sbKwRows = dataMap['sbKw'] ?? []
    const sbKwSalesTotal = sbKwRows.reduce((s: number, r: any) => s + toCents(r.sales14d), 0)
    const sbKwOrdersTotal = sbKwRows.reduce((s: number, r: any) => s + n(r.purchases14d), 0)
    console.log(`[poll] SB Keywords sales check: ${sbKwRows.length} rows, total sales=$${(sbKwSalesTotal/100).toFixed(2)}, orders=${sbKwOrdersTotal}`)
    // sbAttr: aggregate purchased-product rows by campaign+date, UPDATE (or INSERT) sb_campaigns sales/orders
    total += await updateSbCampaignSales(db,  pid, dataMap['sbAttr'] ?? [], dataMap['sbCamp'] ?? [])

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
