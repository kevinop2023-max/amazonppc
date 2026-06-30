import { createClient } from '@/lib/supabase/server'
import ComparisonView from '@/components/ComparisonView'
import type { CampComp, TermComp, KwComp, BidRecord } from '@/components/ComparisonView'
import type { ChangeEvent } from '@/components/ChangesView'
import type { DayData } from '@/components/PerformanceChart'

export const revalidate = 0

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

function n(v: any) { return Number(v ?? 0) }

export default async function ComparisonPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; aStart?: string; aEnd?: string; bStart?: string; bEnd?: string }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase
    .from('amazon_profiles')
    .select('profile_id, marketplace')
    .order('created_at')
    .limit(10)

  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id
    ? Number(searchParams.profile_id)
    : (usProfile ?? profiles?.[0])?.profile_id ?? null

  if (!profileId) {
    return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>
  }

  // Default: A = previous 7 days (14–8 days ago), B = current 7 days (7–1 days ago)
  const aStart = searchParams.aStart ?? dateStr(14)
  const aEnd   = searchParams.aEnd   ?? dateStr(8)
  const bStart = searchParams.bStart ?? dateStr(7)
  const bEnd   = searchParams.bEnd   ?? dateStr(1)

  // 12 parallel queries (last one fetches earliest date for "All Time" button)
  const [spARes, spBRes, sbARes, sbBRes, stARes, stBRes, spKwARes, spKwBRes, sbKwARes, sbKwBRes, bidHistRes, earliestRes] = await Promise.all([
    supabase.from('sp_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks, date')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sp_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks, date')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sb_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks, date')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sb_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks, date')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sp_search_terms')
      .select('campaign_id, keyword_id, customer_search_term, spend_cents, sales_cents, orders, clicks, impressions')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sp_search_terms')
      .select('campaign_id, keyword_id, customer_search_term, spend_cents, sales_cents, orders, clicks, impressions')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sp_keywords')
      .select('keyword_id, campaign_id, keyword_text, match_type, bid_cents, spend_cents, sales_cents, orders, clicks, impressions')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sp_keywords')
      .select('keyword_id, campaign_id, keyword_text, match_type, bid_cents, spend_cents, sales_cents, orders, clicks, impressions')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sb_keywords')
      .select('keyword_id, campaign_id, keyword_text, match_type, bid_cents, spend_cents, sales_cents, orders, clicks, impressions')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sb_keywords')
      .select('keyword_id, campaign_id, keyword_text, match_type, bid_cents, spend_cents, sales_cents, orders, clicks, impressions')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('keyword_bid_history')
      .select('keyword_id, ad_type, bid_cents, recorded_date')
      .eq('profile_id', profileId)
      .order('recorded_date', { ascending: true })
      .range(0, 9999),
    supabase.from('sp_campaigns')
      .select('date')
      .eq('profile_id', profileId)
      .order('date', { ascending: true })
      .limit(1),
  ])

  // Aggregate campaign rows by campaign_id
  function aggCampMap(rows: any[]) {
    const map = new Map<number, { name: string; state: string; budget: number; spend: number; sales: number; orders: number; imp: number; clicks: number }>()
    for (const r of rows) {
      if (!map.has(r.campaign_id)) {
        map.set(r.campaign_id, { name: r.campaign_name ?? '', state: r.state ?? 'enabled', budget: 0, spend: 0, sales: 0, orders: 0, imp: 0, clicks: 0 })
      }
      const c = map.get(r.campaign_id)!
      c.spend  += n(r.spend_cents)
      c.sales  += n(r.sales_cents)
      c.orders += n(r.orders)
      c.imp    += n(r.impressions)
      c.clicks += n(r.clicks)
      // Take the highest seen daily_budget_cents as the effective budget
      const bgt = n(r.daily_budget_cents)
      if (bgt > c.budget) c.budget = bgt
    }
    return map
  }

  const spAMap = aggCampMap(spARes.data ?? [])
  const spBMap = aggCampMap(spBRes.data ?? [])
  const sbAMap = aggCampMap(sbARes.data ?? [])
  const sbBMap = aggCampMap(sbBRes.data ?? [])

  // Merge A + B maps for each ad type into CampComp[]
  const camps: CampComp[] = []

  function mergeCamps(aMap: Map<number, any>, bMap: Map<number, any>, type: 'SP' | 'SB') {
    const ids = new Set([...aMap.keys(), ...bMap.keys()])
    for (const id of ids) {
      const a = aMap.get(id)
      const b = bMap.get(id)
      camps.push({
        id, name: b?.name ?? a?.name ?? '', type,
        state:   b?.state  ?? a?.state  ?? 'enabled',
        aBudget: a?.budget ?? 0,
        bBudget: b?.budget ?? 0,
        aSpend:  a?.spend  ?? 0, aSales:  a?.sales  ?? 0, aOrders: a?.orders ?? 0, aImp: a?.imp ?? 0, aClicks: a?.clicks ?? 0,
        bSpend:  b?.spend  ?? 0, bSales:  b?.sales  ?? 0, bOrders: b?.orders ?? 0, bImp: b?.imp ?? 0, bClicks: b?.clicks ?? 0,
      })
    }
  }
  mergeCamps(spAMap, spBMap, 'SP')
  mergeCamps(sbAMap, sbBMap, 'SB')
  camps.sort((a, b) => b.bSpend - a.bSpend)

  // Daily chart data (SP + SB combined, grouped by date)
  function aggDailyMap(rows: any[]) {
    const map = new Map<string, { spend: number; sales: number; orders: number; clicks: number }>()
    for (const r of rows) {
      const d = r.date ?? ''; if (!d) continue
      if (!map.has(d)) map.set(d, { spend: 0, sales: 0, orders: 0, clicks: 0 })
      const m = map.get(d)!
      m.spend  += n(r.spend_cents)
      m.sales  += n(r.sales_cents)
      m.orders += n(r.orders)
      m.clicks += n(r.clicks)
    }
    return map
  }

  function mergeDailyMaps(mapSp: Map<string, any>, mapSb: Map<string, any>): DayData[] {
    const dates = new Set([...mapSp.keys(), ...mapSb.keys()])
    return [...dates].sort().map(date => ({
      date,
      spendCents: (mapSp.get(date)?.spend ?? 0) + (mapSb.get(date)?.spend ?? 0),
      salesCents: (mapSp.get(date)?.sales ?? 0) + (mapSb.get(date)?.sales ?? 0),
      orders:     (mapSp.get(date)?.orders ?? 0) + (mapSb.get(date)?.orders ?? 0),
      clicks:     (mapSp.get(date)?.clicks ?? 0) + (mapSb.get(date)?.clicks ?? 0),
    }))
  }

  const chartDataA = mergeDailyMaps(aggDailyMap(spARes.data ?? []), aggDailyMap(sbARes.data ?? []))
  const chartDataB = mergeDailyMaps(aggDailyMap(spBRes.data ?? []), aggDailyMap(sbBRes.data ?? []))

  // Build campaign name lookup (id → name) for search terms
  const campNameMap = new Map<number, string>()
  for (const c of camps) campNameMap.set(c.id, c.name)

  // Aggregate search terms by (campaignId, term)
  function aggTermMap(rows: any[]) {
    const map = new Map<string, { campaignId: number; keywordId: number | null; kwSpend: number; spend: number; sales: number; orders: number; clicks: number; imp: number }>()
    for (const r of rows) {
      const term = r.customer_search_term ?? ''
      const cid  = n(r.campaign_id)
      const key  = `${cid}|${term}`
      if (!map.has(key)) map.set(key, { campaignId: cid, keywordId: null, kwSpend: -1, spend: 0, sales: 0, orders: 0, clicks: 0, imp: 0 })
      const t = map.get(key)!
      t.spend  += n(r.spend_cents)
      t.sales  += n(r.sales_cents)
      t.orders += n(r.orders)
      t.clicks += n(r.clicks)
      t.imp    += n(r.impressions)
      if (r.keyword_id && n(r.spend_cents) > t.kwSpend) { t.keywordId = n(r.keyword_id); t.kwSpend = n(r.spend_cents) }
    }
    return map
  }

  const stAMap = aggTermMap(stARes.data ?? [])
  const stBMap = aggTermMap(stBRes.data ?? [])

  const allTermKeys = new Set([...stAMap.keys(), ...stBMap.keys()])
  const terms: TermComp[] = []
  for (const key of allTermKeys) {
    const pipeIdx  = key.indexOf('|')
    const cid      = Number(key.slice(0, pipeIdx))
    const term     = key.slice(pipeIdx + 1)
    const a        = stAMap.get(key)
    const b        = stBMap.get(key)
    terms.push({
      term,
      campaignId:   cid,
      campaignName: campNameMap.get(cid) ?? '',
      keywordId:    b?.keywordId ?? a?.keywordId ?? null,
      bidHistory:   [],
      aSpend:  a?.spend  ?? 0, aSales:  a?.sales  ?? 0, aOrders: a?.orders ?? 0, aClicks: a?.clicks ?? 0, aImp: a?.imp ?? 0,
      bSpend:  b?.spend  ?? 0, bSales:  b?.sales  ?? 0, bOrders: b?.orders ?? 0, bClicks: b?.clicks ?? 0, bImp: b?.imp ?? 0,
    })
  }

  // Aggregate keywords by (campaignId, keywordText, matchType)
  // Build bid history map: "${keyword_id}|${ad_type}" → sorted BidRecord[]
  // Only keep rows where the bid actually changed from the previous entry
  const rawBidHist = bidHistRes.data ?? []
  const bidHistMap = new Map<string, BidRecord[]>()
  for (const r of rawBidHist) {
    const key = `${n(r.keyword_id)}|${r.ad_type ?? 'sp'}`
    if (!bidHistMap.has(key)) bidHistMap.set(key, [])
    bidHistMap.get(key)!.push({ date: r.recorded_date, bidCents: n(r.bid_cents) })
  }
  // Deduplicate consecutive identical bids (keep only change events)
  for (const [key, records] of bidHistMap) {
    bidHistMap.set(key, records.filter((r, i) => i === 0 || r.bidCents !== records[i - 1].bidCents))
  }
  // Attach the triggering target's bid history to each search term (SP)
  for (const t of terms) t.bidHistory = t.keywordId ? (bidHistMap.get(`${t.keywordId}|sp`) ?? []) : []

  function aggKwMap(rows: any[]) {
    const map = new Map<string, { keywordId: number; adType: string; campaignId: number; spend: number; sales: number; orders: number; clicks: number; imp: number; text: string; mt: string }>()
    for (const r of rows) {
      const kwId = n(r.keyword_id)
      const at   = r._adType ?? 'sp'
      const key  = `${at}|${kwId}`
      if (!map.has(key)) map.set(key, { keywordId: kwId, adType: at, campaignId: n(r.campaign_id), spend: 0, sales: 0, orders: 0, clicks: 0, imp: 0, text: r.keyword_text ?? '', mt: r.match_type ?? 'broad' })
      const t = map.get(key)!
      t.spend  += n(r.spend_cents)
      t.sales  += n(r.sales_cents)
      t.orders += n(r.orders)
      t.clicks += n(r.clicks)
      t.imp    += n(r.impressions)
    }
    return map
  }

  // Tag rows with ad_type before combining
  const kwARows = [
    ...(spKwARes.data ?? []).map((r: any) => ({ ...r, _adType: 'sp' })),
    ...(sbKwARes.data ?? []).map((r: any) => ({ ...r, _adType: 'sb' })),
  ]
  const kwBRows = [
    ...(spKwBRes.data ?? []).map((r: any) => ({ ...r, _adType: 'sp' })),
    ...(sbKwBRes.data ?? []).map((r: any) => ({ ...r, _adType: 'sb' })),
  ]
  const kwAMap = aggKwMap(kwARows)
  const kwBMap = aggKwMap(kwBRows)

  const allKwKeys = new Set([...kwAMap.keys(), ...kwBMap.keys()])
  const keywords: KwComp[] = []
  for (const key of allKwKeys) {
    const a   = kwAMap.get(key)
    const b   = kwBMap.get(key)
    const ref = a ?? b!
    const bidKey = `${ref.keywordId}|${ref.adType}`
    keywords.push({
      keywordId:    ref.keywordId,
      keywordText:  ref.text,
      matchType:    ref.mt,
      adType:       ref.adType,
      campaignId:   ref.campaignId,
      campaignName: campNameMap.get(ref.campaignId) ?? '',
      bidHistory:   bidHistMap.get(bidKey) ?? [],
      aSpend:  a?.spend  ?? 0, aSales:  a?.sales  ?? 0, aOrders: a?.orders ?? 0, aClicks: a?.clicks ?? 0, aImp: a?.imp ?? 0,
      bSpend:  b?.spend  ?? 0, bSales:  b?.sales  ?? 0, bOrders: b?.orders ?? 0, bClicks: b?.clicks ?? 0, bImp: b?.imp ?? 0,
    })
  }

  const earliestDate = earliestRes.data?.[0]?.date ?? null

  // ── Change events within the comparison window (A start → B end) ──────────────
  const winStart = aStart < bStart ? aStart : bStart
  const winEnd   = bEnd   > aEnd   ? bEnd   : aEnd
  const [{ data: chgRaw }, { data: agRows }] = await Promise.all([
    supabase.from('change_events')
      .select('id, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, ad_type, source')
      .eq('profile_id', profileId).gte('event_ts', winStart).lte('event_ts', winEnd + 'T23:59:59Z')
      .order('event_ts', { ascending: false }).range(0, 49999),
    supabase.from('sp_ad_groups').select('ad_group_id, ad_group_name').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
  ])

  const kwNameMap = new Map<string, string>()
  for (const k of keywords) { const key = String(k.keywordId); if (!kwNameMap.has(key)) kwNameMap.set(key, k.matchType ? `${k.keywordText} (${k.matchType})` : k.keywordText) }
  const agNameMap = new Map<string, string>()
  for (const a of agRows ?? []) { const key = String(a.ad_group_id); if (!agNameMap.has(key) && a.ad_group_name) agNameMap.set(key, a.ad_group_name) }
  const nameFor = (e: any) => e.entity_type === 'CAMPAIGN' ? (campNameMap.get(Number(e.entity_id)) ?? `Campaign ${e.entity_id}`)
    : (e.entity_type === 'KEYWORD' || e.entity_type === 'PRODUCT_TARGETING') ? (kwNameMap.get(e.entity_id) ?? `${e.entity_type === 'KEYWORD' ? 'Keyword' : 'Target'} ${e.entity_id}`)
    : e.entity_type === 'AD_GROUP' ? (agNameMap.get(e.entity_id) ?? `Ad group ${e.entity_id}`)
    : `${e.entity_type} ${e.entity_id}`

  const changeEvents: ChangeEvent[] = (chgRaw ?? []).map((e: any) => ({
    id: e.id, entity_type: e.entity_type, entity_id: e.entity_id, campaign_id: e.campaign_id, field: e.field,
    old_value: e.old_value == null ? null : Number(e.old_value), new_value: e.new_value == null ? null : Number(e.new_value),
    old_text: e.old_text, new_text: e.new_text, event_ts: e.event_ts, ad_type: e.ad_type, source: e.source,
    entityName: nameFor(e), campaignName: e.campaign_id ? (campNameMap.get(Number(e.campaign_id)) ?? null) : null,
  }))

  return (
    <ComparisonView
      profileId={profileId}
      aStart={aStart} aEnd={aEnd}
      bStart={bStart} bEnd={bEnd}
      camps={camps}
      terms={terms}
      keywords={keywords}
      earliestDate={earliestDate}
      chartDataA={chartDataA}
      chartDataB={chartDataB}
      changeEvents={changeEvents}
    />
  )
}
