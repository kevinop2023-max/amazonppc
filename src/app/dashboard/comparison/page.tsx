import { createClient } from '@/lib/supabase/server'
import ComparisonView from '@/components/ComparisonView'
import type { CampComp, TermComp, KwComp } from '@/components/ComparisonView'

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

  // 10 parallel queries
  const [spARes, spBRes, sbARes, sbBRes, stARes, stBRes, spKwARes, spKwBRes, sbKwARes, sbKwBRes] = await Promise.all([
    supabase.from('sp_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sp_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sb_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sb_campaigns')
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sp_search_terms')
      .select('campaign_id, customer_search_term, spend_cents, sales_cents, orders, clicks')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sp_search_terms')
      .select('campaign_id, customer_search_term, spend_cents, sales_cents, orders, clicks')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sp_keywords')
      .select('campaign_id, keyword_text, match_type, spend_cents, sales_cents, orders, clicks')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sp_keywords')
      .select('campaign_id, keyword_text, match_type, spend_cents, sales_cents, orders, clicks')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
    supabase.from('sb_keywords')
      .select('campaign_id, keyword_text, match_type, spend_cents, sales_cents, orders, clicks')
      .eq('profile_id', profileId).gte('date', aStart).lte('date', aEnd).range(0, 49999),
    supabase.from('sb_keywords')
      .select('campaign_id, keyword_text, match_type, spend_cents, sales_cents, orders, clicks')
      .eq('profile_id', profileId).gte('date', bStart).lte('date', bEnd).range(0, 49999),
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

  // Build campaign name lookup (id → name) for search terms
  const campNameMap = new Map<number, string>()
  for (const c of camps) campNameMap.set(c.id, c.name)

  // Aggregate search terms by (campaignId, term)
  function aggTermMap(rows: any[]) {
    const map = new Map<string, { campaignId: number; spend: number; sales: number; orders: number; clicks: number }>()
    for (const r of rows) {
      const term = r.customer_search_term ?? ''
      const cid  = n(r.campaign_id)
      const key  = `${cid}|${term}`
      if (!map.has(key)) map.set(key, { campaignId: cid, spend: 0, sales: 0, orders: 0, clicks: 0 })
      const t = map.get(key)!
      t.spend  += n(r.spend_cents)
      t.sales  += n(r.sales_cents)
      t.orders += n(r.orders)
      t.clicks += n(r.clicks)
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
      aSpend:  a?.spend  ?? 0, aSales:  a?.sales  ?? 0, aOrders: a?.orders ?? 0, aClicks: a?.clicks ?? 0,
      bSpend:  b?.spend  ?? 0, bSales:  b?.sales  ?? 0, bOrders: b?.orders ?? 0, bClicks: b?.clicks ?? 0,
    })
  }

  // Aggregate keywords by (campaignId, keywordText, matchType)
  function aggKwMap(rows: any[]) {
    const map = new Map<string, { campaignId: number; spend: number; sales: number; orders: number; clicks: number }>()
    for (const r of rows) {
      const kw  = r.keyword_text ?? ''
      const mt  = r.match_type   ?? 'broad'
      const cid = n(r.campaign_id)
      const key = `${cid}|${mt}|${kw}`
      if (!map.has(key)) map.set(key, { campaignId: cid, spend: 0, sales: 0, orders: 0, clicks: 0 })
      const t = map.get(key)!
      t.spend  += n(r.spend_cents)
      t.sales  += n(r.sales_cents)
      t.orders += n(r.orders)
      t.clicks += n(r.clicks)
    }
    return map
  }

  // Combine SP + SB keyword rows per period before aggregating
  const kwARows = [...(spKwARes.data ?? []), ...(sbKwARes.data ?? [])]
  const kwBRows = [...(spKwBRes.data ?? []), ...(sbKwBRes.data ?? [])]
  const kwAMap  = aggKwMap(kwARows)
  const kwBMap  = aggKwMap(kwBRows)

  const allKwKeys = new Set([...kwAMap.keys(), ...kwBMap.keys()])
  const keywords: KwComp[] = []
  for (const key of allKwKeys) {
    const parts = key.split('|')
    const cid   = Number(parts[0])
    const mt    = parts[1]
    const kw    = parts.slice(2).join('|')
    const a     = kwAMap.get(key)
    const b     = kwBMap.get(key)
    keywords.push({
      keywordText:  kw,
      matchType:    mt,
      campaignId:   cid,
      campaignName: campNameMap.get(cid) ?? '',
      aSpend:  a?.spend  ?? 0, aSales:  a?.sales  ?? 0, aOrders: a?.orders ?? 0, aClicks: a?.clicks ?? 0,
      bSpend:  b?.spend  ?? 0, bSales:  b?.sales  ?? 0, bOrders: b?.orders ?? 0, bClicks: b?.clicks ?? 0,
    })
  }

  return (
    <ComparisonView
      profileId={profileId}
      aStart={aStart} aEnd={aEnd}
      bStart={bStart} bEnd={bEnd}
      camps={camps}
      terms={terms}
      keywords={keywords}
    />
  )
}
