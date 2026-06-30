import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Suspense } from 'react'
import DateRangePicker from '@/components/DateRangePicker'
import TargetingTable from '@/components/targeting/TargetingTable'

export const revalidate = 0

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

// Derive targeting type from row data.
// Amazon spTargeting report stores auto rows with match_type='targeting_expression_predefined'
// but the keyword_text (from r.targeting) contains the group name: close-match/loose-match/etc.
// Product/ASIN rows have keyword_text like asin="B07..." or a category expression.
function getTargetType(row: { match_type?: string | null; keyword_text?: string | null }): 'keywords' | 'products' | 'auto' {
  const mt = (row.match_type ?? '').toLowerCase()
  const kw = (row.keyword_text ?? '').toLowerCase()
  if (['exact', 'phrase', 'broad', 'theme'].includes(mt)) return 'keywords'
  if (['close-match', 'loose-match', 'substitutes', 'complements'].includes(kw)) return 'auto'
  return 'products'
}

export default async function TargetingPage({
  searchParams,
}: {
  searchParams: {
    profile_id?: string; days?: string; adType?: string; state?: string
    start?: string; end?: string; tab?: string
  }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, account_name, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null

  const isAllTime = searchParams.days === 'all'
  const days      = isAllTime ? 0 : Number(searchParams.days ?? 30)
  const adType    = (searchParams.adType ?? 'sp') as 'sp' | 'sb' | 'all'
  const activeTab = searchParams.tab ?? 'all'
  const isCustom  = !!(searchParams.start && searchParams.end)
  const startStr  = searchParams.start ?? (isAllTime ? '2020-01-01' : dateStr(days))
  const endStr    = searchParams.end ?? dateStr(1)

  const activeProfileId = profileId

  // ── Fetch targeting rows from SP and/or SB ──────────────────────────────────
  async function fetchKw(table: 'sp_keywords' | 'sb_keywords', adTypeMark: string) {
    if (!activeProfileId) return { meta: [], perf: [], adTypeMark }
    const [{ data: meta }, { data: perf }] = await Promise.all([
      supabase.from(table).select('keyword_id, campaign_id, keyword_text, match_type, state, bid_cents, top_of_search_is')
        .eq('profile_id', activeProfileId).order('date', { ascending: false }).range(0, 49999),
      supabase.from(table).select('keyword_id, impressions, clicks, spend_cents, sales_cents, orders')
        .eq('profile_id', activeProfileId).gte('date', startStr).lte('date', endStr).range(0, 49999),
    ])
    return { meta: meta ?? [], perf: perf ?? [], adTypeMark }
  }

  const sources = adType === 'all'
    ? await Promise.all([fetchKw('sp_keywords', 'SP'), fetchKw('sb_keywords', 'SB')])
    : [await fetchKw(adType === 'sb' ? 'sb_keywords' : 'sp_keywords', adType.toUpperCase())]

  // Previous distinct bid per keyword/target (for "last → current" display)
  const { data: kbhRows } = activeProfileId
    ? await supabase.from('keyword_bid_history').select('keyword_id, ad_type, bid_cents, recorded_date')
        .eq('profile_id', activeProfileId).order('recorded_date', { ascending: true }).range(0, 49999)
    : { data: [] as any[] }
  const prevBidMap = new Map<string, number>()
  {
    const seq = new Map<string, number[]>()
    for (const r of kbhRows ?? []) {
      const k = `${(r.ad_type ?? 'sp').toUpperCase()}|${r.keyword_id}`
      const arr = seq.get(k) ?? []
      if (arr.length === 0 || arr[arr.length - 1] !== r.bid_cents) arr.push(r.bid_cents)  // distinct consecutive
      seq.set(k, arr)
    }
    for (const [k, arr] of seq) if (arr.length >= 2) prevBidMap.set(k, arr[arr.length - 2])
  }

  // Aggregate perf and meta per source
  type KwRow = { keyword_id: number; campaign_id: number; keyword_text: string; match_type: string; state: string; bid_cents: number; impressions: number; clicks: number; spend_cents: number; sales_cents: number; orders: number; adTypeMark: string }
  const allRows: KwRow[] = []

  for (const { meta, perf, adTypeMark } of sources) {
    const perfMap = new Map<number, { impressions: number; clicks: number; spend_cents: number; sales_cents: number; orders: number }>()
    for (const r of perf) {
      const p = perfMap.get(r.keyword_id) ?? { impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0 }
      p.impressions += r.impressions; p.clicks += r.clicks
      p.spend_cents += r.spend_cents; p.sales_cents += r.sales_cents; p.orders += r.orders
      perfMap.set(r.keyword_id, p)
    }
    // meta is date DESC. Take most-recent row for name/state/bid, but the most-recent
    // NON-NULL top_of_search_is (Amazon reports it with a lag, so latest day is often null).
    const metaMap = new Map<number, any>()
    const tosMap = new Map<number, number>()
    for (const r of meta) {
      if (!metaMap.has(r.keyword_id)) metaMap.set(r.keyword_id, r)
      if (r.top_of_search_is != null && !tosMap.has(r.keyword_id)) tosMap.set(r.keyword_id, r.top_of_search_is)
    }
    for (const [, r] of metaMap) {
      allRows.push({ ...r, top_of_search_is: tosMap.get(r.keyword_id) ?? null, prev_bid_cents: prevBidMap.get(`${adTypeMark}|${r.keyword_id}`) ?? null, ...(perfMap.get(r.keyword_id) ?? { impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0 }), adTypeMark })
    }
  }

  let rows = allRows

  // Tab counts (from all rows before tab filter)
  const tabCounts = {
    all:      rows.length,
    keywords: rows.filter(r => getTargetType(r) === 'keywords').length,
    products: rows.filter(r => getTargetType(r) === 'products').length,
    auto:     rows.filter(r => getTargetType(r) === 'auto').length,
  }

  // Apply tab filter
  if (activeTab !== 'all' && activeTab !== 'negatives') {
    rows = rows.filter(r => getTargetType(r) === activeTab)
  }

  // ── Campaign names ──────────────────────────────────────────────────────────
  const campIds = [...new Set(rows.map(r => r.campaign_id).filter(Boolean))]
  const campTables = adType === 'all' ? ['sp_campaigns', 'sb_campaigns'] : [adType === 'sb' ? 'sb_campaigns' : 'sp_campaigns']
  const campaignNames = new Map<number, string>()

  if (campIds.length > 0 && activeProfileId) {
    const campResults = await Promise.all(
      campTables.map(t => supabase.from(t).select('campaign_id, campaign_name')
        .eq('profile_id', activeProfileId).in('campaign_id', campIds)
        .order('date', { ascending: false }).range(0, 4999))
    )
    for (const { data } of campResults) {
      for (const c of data ?? []) {
        if (!campaignNames.has(c.campaign_id)) campaignNames.set(c.campaign_id, c.campaign_name)
      }
    }
  }

  const rowsWithCamp = rows.map(r => ({ ...r, campaignName: campaignNames.get(r.campaign_id) ?? `Campaign ${r.campaign_id}` }))
  const grouped = new Map<string, typeof rowsWithCamp>()
  for (const kw of rowsWithCamp) {
    if (!grouped.has(kw.campaignName)) grouped.set(kw.campaignName, [])
    grouped.get(kw.campaignName)!.push(kw)
  }
  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    b[1].reduce((s, k) => s + k.spend_cents, 0) - a[1].reduce((s, k) => s + k.spend_cents, 0)
  )
  const allCampaigns = sortedGroups.map(([name]) => name)

  // ── Negatives ───────────────────────────────────────────────────────────────
  type NegRow = { keyword_id?: number; target_id?: number; keyword_text?: string; expression?: string; match_type: string; state: string; campaign_id: number; ad_group_id?: number; campaignName: string; level: string; type: 'keyword' | 'target'; adTypeMark: string }

  let negRows: NegRow[] = []
  if (activeProfileId) {
    const empty = { data: [] as any[] }
    // Negatives: show those belonging to ENABLED campaigns (by campaign state, not the negative's own state)
    const [spNegKw, spNegTgt, sbNegKw, enabledCampRes] = await Promise.all([
      adType !== 'sb'
        ? supabase.from('sp_negative_keywords').select('keyword_id, campaign_id, campaign_name, ad_group_id, keyword_text, match_type, state').eq('profile_id', activeProfileId).range(0, 9999)
        : Promise.resolve(empty),
      adType !== 'sb'
        ? supabase.from('sp_negative_targets').select('target_id, campaign_id, campaign_name, ad_group_id, expression, state').eq('profile_id', activeProfileId).range(0, 9999)
        : Promise.resolve(empty),
      adType !== 'sp'
        ? supabase.from('sb_negative_keywords').select('keyword_id, campaign_id, campaign_name, keyword_text, match_type, state').eq('profile_id', activeProfileId).range(0, 9999)
        : Promise.resolve(empty),
      // Most-recent state per campaign (campaign-level state, kept current by syncCampaignStates)
      Promise.all(campTables.map(t => supabase.from(t).select('campaign_id, state, date')
        .eq('profile_id', activeProfileId).order('date', { ascending: false }).range(0, 49999))),
    ])

    // Build set of enabled campaign IDs (first row per campaign = most recent state)
    const campState = new Map<number, string>()
    for (const { data } of (enabledCampRes as any[])) {
      for (const c of data ?? []) {
        if (!campState.has(c.campaign_id)) campState.set(c.campaign_id, (c.state ?? '').toLowerCase())
      }
    }
    const isEnabledCampaign = (cid: number) => campState.get(cid) === 'enabled'

    const nm = (r: any) => r.campaign_name || `Campaign ${r.campaign_id}`
    for (const r of spNegKw.data ?? [])  if (isEnabledCampaign(r.campaign_id)) negRows.push({ ...r, campaignName: nm(r), level: r.ad_group_id ? 'Ad Group' : 'Campaign', type: 'keyword', adTypeMark: 'SP' })
    for (const r of spNegTgt.data ?? []) if (isEnabledCampaign(r.campaign_id)) negRows.push({ ...r, campaignName: nm(r), level: r.ad_group_id ? 'Ad Group' : 'Campaign', type: 'target',  adTypeMark: 'SP' })
    for (const r of sbNegKw.data ?? [])  if (isEnabledCampaign(r.campaign_id)) negRows.push({ ...r, campaignName: nm(r), level: 'Campaign',                                      type: 'keyword', adTypeMark: 'SB' })
  }

  const negGrouped = new Map<string, NegRow[]>()
  for (const n of negRows) {
    if (!negGrouped.has(n.campaignName)) negGrouped.set(n.campaignName, [])
    negGrouped.get(n.campaignName)!.push(n)
  }
  const negSortedGroups = [...negGrouped.entries()]
  const negCampaigns = negSortedGroups.map(([name]) => name).sort()

  // ── URL builder (server-rendered links only) ─────────────────────────────────
  const buildUrl = (params: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = {
      profile_id: String(activeProfileId),
      days: isAllTime ? 'all' : String(days),
      adType: adType !== 'sp' ? adType : undefined,
      start: searchParams.start, end: searchParams.end,
      tab: activeTab !== 'all' ? activeTab : undefined,
      ...params,
    }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    return `/dashboard/targeting?${qs}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Targeting</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {rows.length} targets · {sortedGroups.length} campaigns · {adType.toUpperCase()} · {isAllTime ? 'All time' : isCustom ? `${startStr} – ${endStr}` : `Last ${days} days`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* All / SP / SB */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {([['all','All'],['sp','SP'],['sb','SB']] as const).map(([t, label]) => (
              <Link key={t} href={buildUrl({ adType: t === 'sp' ? undefined : t, tab: undefined })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  adType === t
                    ? t === 'sp' ? 'bg-blue-500 text-white' : t === 'sb' ? 'bg-purple-500 text-white' : 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
                {label}
              </Link>
            ))}
          </div>
          {/* Day range */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {[7,14,30,90].map(d => (
              <Link key={d} href={buildUrl({ days: String(d), start: undefined, end: undefined })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${!isCustom && !isAllTime && days === d ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
                {d}d
              </Link>
            ))}
            <Link href={buildUrl({ days: 'all', start: undefined, end: undefined })}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${isAllTime ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
              All
            </Link>
          </div>
          <Suspense fallback={null}>
            <DateRangePicker start={startStr} end={endStr} basePath="/dashboard/targeting" />
          </Suspense>
        </div>
      </div>

      <TargetingTable
        adType={adType}
        activeTab={activeTab}
        sortedGroups={sortedGroups as any}
        negGroups={negSortedGroups as any}
        campaigns={allCampaigns}
        negCampaigns={negCampaigns}
        tabCounts={{ ...tabCounts, negatives: negRows.length }}
        baseParams={{
          profileId: String(activeProfileId ?? ''),
          days: isAllTime ? 'all' : String(days),
          adType,
          state: '',
          start: searchParams.start ?? '',
          end: searchParams.end ?? '',
        }}
      />
    </div>
  )
}
