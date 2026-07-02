import { createClient } from '@/lib/supabase/server'
import TargetsView from '@/components/targets/TargetsView'
import { clientDateStr, fmtD, fmtDate } from '@/components/targets/ab'
import { AB, zeroAB, BidPoint, ChangePt, ChangeChip, TermItem, TargetItem, PlacementInfo, CampaignGroup, NegRow } from '@/components/targets/types'

export const revalidate = 0

// Derive targeting type from row data (same rule as the old Targeting page).
function getTargetType(row: { match_type?: string | null; keyword_text?: string | null }): 'keywords' | 'products' | 'auto' {
  const mt = (row.match_type ?? '').toLowerCase()
  const kw = (row.keyword_text ?? '').toLowerCase()
  if (['exact', 'phrase', 'broad', 'theme'].includes(mt)) return 'keywords'
  if (['close-match', 'loose-match', 'substitutes', 'complements'].includes(kw)) return 'auto'
  return 'products'
}

// Placement position → display label. SP uses TOP / REST_OF_SEARCH / DETAIL_PAGE;
// SB placement events use TOP / OTHER / HOME (verified against live change_events).
const POS_LABEL: Record<string, string> = {
  TOP: 'Top of search', REST_OF_SEARCH: 'Rest of search', DETAIL_PAGE: 'Product pages',
  PRODUCT_PAGE: 'Product pages', PRODUCT_PAGES: 'Product pages', HOME: 'Home', OTHER: 'Other placements',
}
// Position → SP placements-panel bucket (SB-only positions return null).
const POS_BUCKET: Record<string, 'top' | 'product' | 'rest'> = {
  TOP: 'top', DETAIL_PAGE: 'product', PRODUCT_PAGE: 'product', PRODUCT_PAGES: 'product', REST_OF_SEARCH: 'rest',
}
// Legacy snapshot-era field names map straight to buckets.
const LEGACY_FIELD_BUCKET: Record<string, 'top' | 'product' | 'rest'> = {
  PLACEMENT_TOP: 'top', PLACEMENT_PRODUCT_PAGE: 'product', PLACEMENT_REST_OF_SEARCH: 'rest',
}

const MATCH_GROUPS = new Set(['loose-match', 'close-match', 'substitutes', 'complements'])
const isAsin = (s: string) => /^b0[a-z0-9]{8}$/i.test(s.trim())

export default async function TargetsPage({
  searchParams,
}: {
  searchParams: {
    profile_id?: string; aStart?: string; aEnd?: string; bStart?: string; bEnd?: string
    adType?: string; tab?: string; anchor?: string
  }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, account_name, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  // A/B windows — defaults match the Comparison page (A = 14..8 days ago, B = 7..1)
  const aStart = searchParams.aStart ?? clientDateStr(14)
  const aEnd   = searchParams.aEnd   ?? clientDateStr(8)
  const bStart = searchParams.bStart ?? clientDateStr(7)
  const bEnd   = searchParams.bEnd   ?? clientDateStr(1)
  const adType = (searchParams.adType ?? 'all') as 'all' | 'sp' | 'sb'
  const tab    = searchParams.tab ?? 'all'
  const anchor = searchParams.anchor ?? null

  const wantSp = adType !== 'sb'
  const wantSb = adType !== 'sp'
  const empty = Promise.resolve({ data: [] as any[] })

  const win = (table: string, cols: string, s: string, e: string) =>
    supabase.from(table).select(cols).eq('profile_id', profileId).gte('date', s).lte('date', e).range(0, 49999)

  const CAMP_COLS = 'campaign_id, spend_cents, sales_cents, orders, impressions, clicks'
  const KW_COLS   = 'keyword_id, campaign_id, spend_cents, sales_cents, orders, clicks, impressions'
  const ST_COLS   = 'campaign_id, keyword_id, customer_search_term, match_type, targeting_keyword, spend_cents, sales_cents, orders, clicks, impressions'
  const PL_COLS   = 'campaign_id, placement, spend_cents, sales_cents, orders, clicks, impressions'

  const [
    spCampA, spCampB, sbCampA, sbCampB,
    spKwA, spKwB, sbKwA, sbKwB,
    spStA, spStB, sbStA, sbStB,
    plA, plB,
    spKwMeta, sbKwMeta,
    spCampMeta, sbCampMeta,
    kbhRes, chgRes,
    spNegKw, spNegTgt, sbNegKw,
    earliestRes,
  ] = await Promise.all([
    wantSp ? win('sp_campaigns', CAMP_COLS, aStart, aEnd) : empty,
    wantSp ? win('sp_campaigns', CAMP_COLS, bStart, bEnd) : empty,
    wantSb ? win('sb_campaigns', CAMP_COLS, aStart, aEnd) : empty,
    wantSb ? win('sb_campaigns', CAMP_COLS, bStart, bEnd) : empty,
    wantSp ? win('sp_keywords', KW_COLS, aStart, aEnd) : empty,
    wantSp ? win('sp_keywords', KW_COLS, bStart, bEnd) : empty,
    wantSb ? win('sb_keywords', KW_COLS, aStart, aEnd) : empty,
    wantSb ? win('sb_keywords', KW_COLS, bStart, bEnd) : empty,
    wantSp ? win('sp_search_terms', ST_COLS, aStart, aEnd) : empty,
    wantSp ? win('sp_search_terms', ST_COLS, bStart, bEnd) : empty,
    wantSb ? win('sb_search_terms', ST_COLS, aStart, aEnd) : empty,
    wantSb ? win('sb_search_terms', ST_COLS, bStart, bEnd) : empty,
    wantSp ? win('placement_performance', PL_COLS, aStart, aEnd) : empty,
    wantSp ? win('placement_performance', PL_COLS, bStart, bEnd) : empty,
    wantSp ? supabase.from('sp_keywords').select('keyword_id, campaign_id, keyword_text, match_type, state, bid_cents, top_of_search_is').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999) : empty,
    wantSb ? supabase.from('sb_keywords').select('keyword_id, campaign_id, keyword_text, match_type, state, bid_cents, top_of_search_is').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999) : empty,
    supabase.from('sp_campaigns').select('campaign_id, campaign_name, state, daily_budget_cents, bidding_strategy, placement_top_pct, placement_product_pct, placement_rest_pct').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
    supabase.from('sb_campaigns').select('campaign_id, campaign_name, state, daily_budget_cents').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
    supabase.from('keyword_bid_history').select('keyword_id, ad_type, bid_cents, recorded_date').eq('profile_id', profileId).order('recorded_date', { ascending: true }).range(0, 49999),
    supabase.from('change_events').select('id, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, metadata')
      .eq('profile_id', profileId)
      .in('field', ['BID_AMOUNT', 'PLACEMENT_GROUP', 'PLACEMENT_TOP', 'PLACEMENT_PRODUCT_PAGE', 'PLACEMENT_REST_OF_SEARCH', 'SMART_BIDDING_STRATEGY', 'BUDGET_AMOUNT'])
      .order('event_ts', { ascending: true }).range(0, 49999),
    wantSp ? supabase.from('sp_negative_keywords').select('keyword_id, campaign_id, campaign_name, ad_group_id, keyword_text, match_type, state').eq('profile_id', profileId).range(0, 9999) : empty,
    wantSp ? supabase.from('sp_negative_targets').select('target_id, campaign_id, campaign_name, ad_group_id, expression, state').eq('profile_id', profileId).range(0, 9999) : empty,
    wantSb ? supabase.from('sb_negative_keywords').select('keyword_id, campaign_id, campaign_name, keyword_text, match_type, state').eq('profile_id', profileId).range(0, 9999) : empty,
    supabase.from('sp_campaigns').select('date').eq('profile_id', profileId).order('date', { ascending: true }).limit(1),
  ])

  const earliestDate: string | null = (earliestRes.data as any[])?.[0]?.date ?? null

  // ── Campaign meta (latest row per campaign; rows are date DESC) ──────────────
  type CampMeta = { name: string; state: string; budgetCents: number; strategy: string | null; top: number | null; product: number | null; rest: number | null }
  const campMeta = new Map<string, CampMeta>()  // `${AD}|${campaign_id}`
  for (const c of spCampMeta.data ?? []) {
    const k = `SP|${c.campaign_id}`
    if (!campMeta.has(k)) campMeta.set(k, { name: c.campaign_name || `Campaign ${c.campaign_id}`, state: (c.state ?? '').toLowerCase(), budgetCents: c.daily_budget_cents ?? 0, strategy: c.bidding_strategy ?? null, top: c.placement_top_pct != null ? Number(c.placement_top_pct) : null, product: c.placement_product_pct != null ? Number(c.placement_product_pct) : null, rest: c.placement_rest_pct != null ? Number(c.placement_rest_pct) : null })
  }
  for (const c of sbCampMeta.data ?? []) {
    const k = `SB|${c.campaign_id}`
    if (!campMeta.has(k)) campMeta.set(k, { name: c.campaign_name || `Campaign ${c.campaign_id}`, state: (c.state ?? '').toLowerCase(), budgetCents: c.daily_budget_cents ?? 0, strategy: null, top: null, product: null, rest: null })
  }

  // ── A/B accumulator helpers ───────────────────────────────────────────────────
  const addSide = (t: AB, side: 'a' | 'b', r: any) => {
    if (side === 'a') { t.aSpend += r.spend_cents ?? 0; t.aSales += r.sales_cents ?? 0; t.aOrders += r.orders ?? 0; t.aClicks += r.clicks ?? 0; t.aImp += r.impressions ?? 0 }
    else { t.bSpend += r.spend_cents ?? 0; t.bSales += r.sales_cents ?? 0; t.bOrders += r.orders ?? 0; t.bClicks += r.clicks ?? 0; t.bImp += r.impressions ?? 0 }
  }
  const accumulate = (map: Map<string, AB>, key: string, side: 'a' | 'b', r: any) => {
    if (!map.has(key)) map.set(key, zeroAB())
    addSide(map.get(key)!, side, r)
  }

  // Campaign A/B totals
  const campAB = new Map<string, AB>()
  for (const r of spCampA.data ?? []) accumulate(campAB, `SP|${r.campaign_id}`, 'a', r)
  for (const r of spCampB.data ?? []) accumulate(campAB, `SP|${r.campaign_id}`, 'b', r)
  for (const r of sbCampA.data ?? []) accumulate(campAB, `SB|${r.campaign_id}`, 'a', r)
  for (const r of sbCampB.data ?? []) accumulate(campAB, `SB|${r.campaign_id}`, 'b', r)

  // Keyword A/B perf
  const kwAB = new Map<string, AB>()
  for (const r of spKwA.data ?? []) accumulate(kwAB, `SP|${r.keyword_id}`, 'a', r)
  for (const r of spKwB.data ?? []) accumulate(kwAB, `SP|${r.keyword_id}`, 'b', r)
  for (const r of sbKwA.data ?? []) accumulate(kwAB, `SB|${r.keyword_id}`, 'a', r)
  for (const r of sbKwB.data ?? []) accumulate(kwAB, `SB|${r.keyword_id}`, 'b', r)

  // ── Keyword meta: latest row per keyword + most-recent non-null Top IS ────────
  type KwMeta = { keywordId: string; campaignId: string; text: string; matchType: string; state: string; bidCents: number; adType: 'SP' | 'SB' }
  const kwMeta = new Map<string, KwMeta>()  // `${AD}|${keyword_id}`
  const tosMap = new Map<string, number>()
  const readKwMeta = (rows: any[], ad: 'SP' | 'SB') => {
    for (const r of rows) {
      const k = `${ad}|${r.keyword_id}`
      if (!kwMeta.has(k)) kwMeta.set(k, { keywordId: String(r.keyword_id), campaignId: String(r.campaign_id), text: r.keyword_text ?? '', matchType: r.match_type ?? '', state: (r.state ?? '').toLowerCase(), bidCents: r.bid_cents ?? 0, adType: ad })
      if (r.top_of_search_is != null && !tosMap.has(k)) tosMap.set(k, Number(r.top_of_search_is))
    }
  }
  readKwMeta(spKwMeta.data ?? [], 'SP')
  readKwMeta(sbKwMeta.data ?? [], 'SB')

  // ── Bid history: distinct change points per target (cap 40 shipped) ──────────
  const bidHistMap = new Map<string, BidPoint[]>()  // `${AD}|${keyword_id}`
  for (const r of kbhRes.data ?? []) {
    const k = `${(r.ad_type ?? 'sp').toUpperCase()}|${r.keyword_id}`
    const arr = bidHistMap.get(k) ?? []
    if (arr.length === 0 || arr[arr.length - 1].bidCents !== r.bid_cents) arr.push({ date: r.recorded_date, bidCents: r.bid_cents })
    bidHistMap.set(k, arr)
  }

  // ── Change events → per-target bid events + per-campaign chips + placement series ──
  const bidEventsMap = new Map<string, ChangePt[]>()          // entity_id (keyword id)
  const chipMap = new Map<string, ChangeChip[]>()             // `${AD}|${campaign_id}`
  const placementEvents = new Map<string, ChangePt[]>()       // `${campaign_id}|${bucket}` (SP panel)
  const latestBidChip = new Map<string, ChangeChip>()         // entity_id → latest bid chip

  const adOfCampaign = (cid: string | null): 'SP' | 'SB' | null =>
    cid == null ? null : campMeta.has(`SP|${cid}`) ? 'SP' : campMeta.has(`SB|${cid}`) ? 'SB' : null

  for (const e of chgRes.data ?? []) {
    const ad = adOfCampaign(e.campaign_id)
    if (!ad) continue
    if ((adType === 'sp' && ad === 'SB') || (adType === 'sb' && ad === 'SP')) continue
    const campKey = `${ad}|${e.campaign_id}`
    let label: string | null = null

    if (e.field === 'BID_AMOUNT' && (e.entity_type === 'KEYWORD' || e.entity_type === 'PRODUCT_TARGETING')) {
      const eid = String(e.entity_id)
      const arr = bidEventsMap.get(eid) ?? []
      arr.push({ ts: e.event_ts, old_value: e.old_value != null ? Number(e.old_value) : null, new_value: e.new_value != null ? Number(e.new_value) : null })
      bidEventsMap.set(eid, arr)
      const text = kwMeta.get(`${ad}|${eid}`)?.text ?? ''
      label = `Bid ${e.old_value != null ? fmtD(Number(e.old_value)) : '—'}→${e.new_value != null ? fmtD(Number(e.new_value)) : '—'}${text ? ` · ${text.slice(0, 24)}` : ''}`
      latestBidChip.set(eid, { id: e.id, ts: e.event_ts, field: e.field, label })
    } else if (e.field === 'PLACEMENT_GROUP' || LEGACY_FIELD_BUCKET[e.field]) {
      const pos = e.field === 'PLACEMENT_GROUP' ? (e.metadata?.placementGroupPosition ?? null) : null
      const bucket = e.field === 'PLACEMENT_GROUP' ? (pos ? POS_BUCKET[pos] ?? null : null) : LEGACY_FIELD_BUCKET[e.field]
      const posLabel = e.field === 'PLACEMENT_GROUP' ? (pos ? POS_LABEL[pos] ?? String(pos) : 'Placement') : POS_LABEL[Object.keys(POS_BUCKET).find(k => POS_BUCKET[k] === bucket) ?? ''] ?? 'Placement'
      label = `${posLabel} ${e.old_value ?? '—'}%→${e.new_value ?? '—'}%`
      if (ad === 'SP' && bucket) {
        const pk = `${e.campaign_id}|${bucket}`
        const arr = placementEvents.get(pk) ?? []
        arr.push({ ts: e.event_ts, old_value: e.old_value != null ? Number(e.old_value) : null, new_value: e.new_value != null ? Number(e.new_value) : null })
        placementEvents.set(pk, arr)
      }
    } else if (e.field === 'SMART_BIDDING_STRATEGY') {
      label = `Strategy ${e.old_text ?? '—'}→${e.new_text ?? '—'}`
    } else if (e.field === 'BUDGET_AMOUNT') {
      label = `Budget ${e.old_value != null ? fmtD(Number(e.old_value)) : '—'}→${e.new_value != null ? fmtD(Number(e.new_value)) : '—'}`
    }

    if (label) {
      const arr = chipMap.get(campKey) ?? []
      arr.push({ id: e.id, ts: e.event_ts, field: e.field, label: `${fmtDate(e.event_ts)} · ${label}` })
      chipMap.set(campKey, arr)
    }
  }

  // ── Placement A/B performance per campaign (SP only) ─────────────────────────
  const placeBucket = (txt: string): 'top' | 'product' | 'rest' => {
    const t = (txt ?? '').toLowerCase()
    return t.includes('top') ? 'top' : (t.includes('detail') || t.includes('product')) ? 'product' : 'rest'
  }
  const plAB = new Map<string, AB>()  // `${campaign_id}|${bucket}`
  for (const r of plA.data ?? []) accumulate(plAB, `${r.campaign_id}|${placeBucket(r.placement)}`, 'a', r)
  for (const r of plB.data ?? []) accumulate(plAB, `${r.campaign_id}|${placeBucket(r.placement)}`, 'b', r)

  // ── Search terms: A/B per (adType, campaign, term) + triggering-target attribution ──
  type TermAgg = AB & { term: string; matchType: string | null; targeting: string | null; keywordId: string | null; kwSpend: number; campaignId: string; adType: 'SP' | 'SB' }
  const termMap = new Map<string, TermAgg>()
  const readTerms = (rows: any[], ad: 'SP' | 'SB', side: 'a' | 'b') => {
    for (const r of rows) {
      const term = (r.customer_search_term ?? '').trim()
      if (!term) continue
      const tl = term.toLowerCase()
      if (MATCH_GROUPS.has(tl) || isAsin(tl)) continue
      const key = `${ad}|${r.campaign_id}|${tl}`
      if (!termMap.has(key)) termMap.set(key, { ...zeroAB(), term, matchType: r.match_type ?? null, targeting: r.targeting_keyword ?? null, keywordId: null, kwSpend: -1, campaignId: String(r.campaign_id), adType: ad })
      const t = termMap.get(key)!
      addSide(t, side, r)
      if (r.keyword_id && (r.spend_cents ?? 0) > t.kwSpend) { t.keywordId = String(r.keyword_id); t.kwSpend = r.spend_cents ?? 0 }
      if (!t.targeting && r.targeting_keyword) t.targeting = r.targeting_keyword
    }
  }
  readTerms(spStA.data ?? [], 'SP', 'a')
  readTerms(spStB.data ?? [], 'SP', 'b')
  readTerms(sbStA.data ?? [], 'SB', 'a')
  readTerms(sbStB.data ?? [], 'SB', 'b')

  // Text-match fallback: per campaign, keyword_text (lowercased) → keyword id.
  const textToKw = new Map<string, string>()  // `${AD}|${campaign_id}|${text}`
  for (const [, m] of kwMeta) {
    const t = m.text.trim().toLowerCase()
    if (t) textToKw.set(`${m.adType}|${m.campaignId}|${t}`, m.keywordId)
  }

  const termsByTarget = new Map<string, TermItem[]>()     // `${AD}|${keyword_id}`
  const unattributed = new Map<string, TermItem[]>()      // `${AD}|${campaign_id}`
  for (const [, t] of termMap) {
    const item: TermItem = { term: t.term, matchType: t.matchType, keywordId: t.keywordId, aSpend: t.aSpend, aSales: t.aSales, aOrders: t.aOrders, aClicks: t.aClicks, aImp: t.aImp, bSpend: t.bSpend, bSales: t.bSales, bOrders: t.bOrders, bClicks: t.bClicks, bImp: t.bImp }
    let kwKey = t.keywordId && kwMeta.has(`${t.adType}|${t.keywordId}`) ? `${t.adType}|${t.keywordId}` : null
    if (!kwKey && t.targeting) {
      const viaText = textToKw.get(`${t.adType}|${t.campaignId}|${t.targeting.trim().toLowerCase()}`)
      if (viaText) { kwKey = `${t.adType}|${viaText}`; item.keywordId = viaText }
    }
    if (kwKey) {
      const arr = termsByTarget.get(kwKey) ?? []
      arr.push(item); termsByTarget.set(kwKey, arr)
    } else {
      const ck = `${t.adType}|${t.campaignId}`
      const arr = unattributed.get(ck) ?? []
      arr.push(item); unattributed.set(ck, arr)
    }
  }

  // ── Build campaign groups ─────────────────────────────────────────────────────
  const TERM_CAP = 50, UNATTR_CAP = 100
  const byCampaign = new Map<string, TargetItem[]>()
  const tabCounts = { all: 0, keywords: 0, products: 0, auto: 0 }

  for (const [k, m] of kwMeta) {
    const ab = kwAB.get(k) ?? zeroAB()
    const hasActivity = ab.aSpend + ab.bSpend + ab.aClicks + ab.bClicks + ab.aImp + ab.bImp > 0
    if (!hasActivity && m.state !== 'enabled') continue
    const hist = bidHistMap.get(k) ?? []
    const terms = (termsByTarget.get(k) ?? []).sort((x, y) => (y.bSpend + y.aSpend) - (x.bSpend + x.aSpend))
    const targetType = getTargetType({ match_type: m.matchType, keyword_text: m.text })
    tabCounts.all++; tabCounts[targetType]++
    const item: TargetItem = {
      keywordId: m.keywordId, adType: m.adType, text: m.text, matchType: m.matchType, state: m.state,
      targetType,
      bidCents: hist.length ? hist[hist.length - 1].bidCents : m.bidCents,
      prevBidCents: hist.length >= 2 ? hist[hist.length - 2].bidCents : null,
      topIs: tosMap.get(k) ?? null,
      bidHistory: hist.slice(-40),
      bidEvents: bidEventsMap.get(m.keywordId) ?? [],
      latestChip: latestBidChip.get(m.keywordId) ?? null,
      searchTerms: terms.slice(0, TERM_CAP),
      omittedTermCount: Math.max(0, terms.length - TERM_CAP),
      ...ab,
    }
    const ck = `${m.adType}|${m.campaignId}`
    const arr = byCampaign.get(ck) ?? []
    arr.push(item); byCampaign.set(ck, arr)
  }

  const groupKeys = new Set<string>([...byCampaign.keys(), ...unattributed.keys()])
  const groups: CampaignGroup[] = []
  for (const ck of groupKeys) {
    const [ad, cid] = ck.split('|') as ['SP' | 'SB', string]
    const meta = campMeta.get(ck)
    if (!meta) continue
    const ab = campAB.get(ck) ?? zeroAB()
    const targets = (byCampaign.get(ck) ?? []).sort((x, y) => (y.bSpend + y.aSpend) - (x.bSpend + x.aSpend))
    const un = (unattributed.get(ck) ?? []).sort((x, y) => (y.bSpend + y.aSpend) - (x.bSpend + x.aSpend))
    if (!targets.length && !un.length) continue

    const placements: PlacementInfo[] = ad === 'SP' ? ([
      ['top', 'Top of search', meta.top] as const,
      ['product', 'Product pages', meta.product] as const,
      ['rest', 'Rest of search', meta.rest] as const,
    ]).map(([key, label, pct]) => ({
      key, label, currentPct: pct,
      events: placementEvents.get(`${cid}|${key}`) ?? [],
      ...(plAB.get(`${cid}|${key}`) ?? zeroAB()),
    })) : []

    const chips = (chipMap.get(ck) ?? []).sort((x, y) => y.ts.localeCompare(x.ts)).slice(0, 24)

    groups.push({
      id: cid, name: meta.name, adType: ad, state: meta.state, budgetCents: meta.budgetCents,
      strategy: meta.strategy, placements, targets,
      unattributedTerms: un.slice(0, UNATTR_CAP), omittedUnattributed: Math.max(0, un.length - UNATTR_CAP),
      changeChips: chips, ...ab,
    })
  }
  groups.sort((x, y) => (y.aSpend + y.bSpend) - (x.aSpend + x.bSpend))

  // ── Negatives (enabled campaigns only — campaign-level state) ─────────────────
  const isEnabledCampaign = (ad: 'SP' | 'SB', cid: any) => campMeta.get(`${ad}|${cid}`)?.state === 'enabled'
  const negRows: (NegRow & { campKey: string })[] = []
  for (const r of spNegKw.data ?? []) if (isEnabledCampaign('SP', r.campaign_id)) negRows.push({ key: `spk-${r.keyword_id}`, text: r.keyword_text ?? '', matchType: r.match_type ?? '', state: (r.state ?? '').toLowerCase(), level: r.ad_group_id ? 'Ad Group' : 'Campaign', adTypeMark: 'SP', campaignName: r.campaign_name || `Campaign ${r.campaign_id}`, campKey: `SP|${r.campaign_id}` })
  for (const r of spNegTgt.data ?? []) if (isEnabledCampaign('SP', r.campaign_id)) {
    let text = r.expression ?? ''
    try { text = JSON.parse(r.expression)?.[0]?.value ?? text } catch {}
    negRows.push({ key: `spt-${r.target_id}`, text, matchType: 'product target', state: (r.state ?? '').toLowerCase(), level: r.ad_group_id ? 'Ad Group' : 'Campaign', adTypeMark: 'SP', campaignName: r.campaign_name || `Campaign ${r.campaign_id}`, campKey: `SP|${r.campaign_id}` })
  }
  for (const r of sbNegKw.data ?? []) if (isEnabledCampaign('SB', r.campaign_id)) negRows.push({ key: `sbk-${r.keyword_id}`, text: r.keyword_text ?? '', matchType: r.match_type ?? '', state: (r.state ?? '').toLowerCase(), level: 'Campaign', adTypeMark: 'SB', campaignName: r.campaign_name || `Campaign ${r.campaign_id}`, campKey: `SB|${r.campaign_id}` })

  const negGrouped = new Map<string, NegRow[]>()
  for (const nr of negRows) {
    if (!negGrouped.has(nr.campaignName)) negGrouped.set(nr.campaignName, [])
    negGrouped.get(nr.campaignName)!.push(nr)
  }
  const negGroups = [...negGrouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <TargetsView
      profileId={profileId}
      aStart={aStart} aEnd={aEnd} bStart={bStart} bEnd={bEnd}
      adType={adType} tab={tab} anchor={anchor}
      earliestDate={earliestDate}
      groups={groups}
      negGroups={negGroups}
      tabCounts={{ ...tabCounts, negatives: negRows.length }}
    />
  )
}
