import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Suspense } from 'react'
import DateRangePicker from '@/components/DateRangePicker'
import TargetingTable from '@/components/targeting/TargetingTable'

export const revalidate = 0

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

// Which match types belong to each tab
const TAB_TYPES: Record<string, string[]> = {
  keywords: ['exact','phrase','broad','theme'],
  products: ['targeting_expression','targeting_expression_predefined'],
  auto:     ['close-match','loose-match','substitutes','complements'],
}

export default async function TargetingPage({
  searchParams,
}: {
  searchParams: {
    profile_id?: string; days?: string; adType?: string; state?: string
    start?: string; end?: string; tab?: string; campaign?: string
  }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, account_name, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null

  const isAllTime = searchParams.days === 'all'
  const days      = isAllTime ? 0 : Number(searchParams.days ?? 30)
  const adType    = (searchParams.adType ?? 'sp') as 'sp' | 'sb'
  const kwState   = searchParams.state ?? 'all'
  const activeTab = searchParams.tab ?? 'all'
  const isCustom  = !!(searchParams.start && searchParams.end)
  const startStr  = searchParams.start ?? (isAllTime ? '2020-01-01' : dateStr(days))
  const endStr    = searchParams.end ?? dateStr(1)

  const kwTable   = adType === 'sb' ? 'sb_keywords'  : 'sp_keywords'
  const campTable = adType === 'sb' ? 'sb_campaigns' : 'sp_campaigns'

  const activeProfileId = profileId

  // ── Fetch targeting rows (all-time meta + date-range perf) ──────────────────
  const [{ data: kwRows }, { data: kwPerfRows }] = activeProfileId ? await Promise.all([
    supabase.from(kwTable)
      .select('keyword_id, campaign_id, keyword_text, match_type, state, bid_cents')
      .eq('profile_id', activeProfileId)
      .order('date', { ascending: false })
      .range(0, 49999),
    supabase.from(kwTable)
      .select('keyword_id, impressions, clicks, spend_cents, sales_cents, orders')
      .eq('profile_id', activeProfileId)
      .gte('date', startStr).lte('date', endStr)
      .range(0, 49999),
  ]) : [{ data: [] }, { data: [] }]

  // Aggregate perf per keyword_id
  const perfMap = new Map<number, { impressions: number; clicks: number; spend_cents: number; sales_cents: number; orders: number }>()
  for (const r of kwPerfRows ?? []) {
    const p = perfMap.get(r.keyword_id) ?? { impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0 }
    p.impressions += r.impressions; p.clicks += r.clicks
    p.spend_cents += r.spend_cents; p.sales_cents += r.sales_cents; p.orders += r.orders
    perfMap.set(r.keyword_id, p)
  }

  // Dedupe meta (most-recent row per keyword_id)
  const metaMap = new Map<number, any>()
  for (const r of kwRows ?? []) {
    if (!metaMap.has(r.keyword_id)) metaMap.set(r.keyword_id, r)
  }

  let rows = Array.from(metaMap.values()).map(r => ({
    ...r,
    ...(perfMap.get(r.keyword_id) ?? { impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0 }),
  }))

  // Apply state filter
  if (kwState !== 'all') rows = rows.filter(r => r.state === kwState)

  // Apply tab filter
  if (activeTab !== 'all' && activeTab !== 'negatives' && TAB_TYPES[activeTab]) {
    rows = rows.filter(r => TAB_TYPES[activeTab].includes((r.match_type ?? '').toLowerCase()))
  }

  // ── Fetch campaign names ────────────────────────────────────────────────────
  const campIds = [...new Set(rows.map(r => r.campaign_id).filter(Boolean))]
  const { data: campRows } = campIds.length > 0
    ? await supabase.from(campTable).select('campaign_id, campaign_name')
        .eq('profile_id', activeProfileId!).in('campaign_id', campIds)
        .order('date', { ascending: false }).range(0, 4999)
    : { data: [] as any[] }

  const campaignNames = new Map<number, string>()
  for (const c of campRows ?? []) {
    if (!campaignNames.has(c.campaign_id)) campaignNames.set(c.campaign_id, c.campaign_name)
  }

  // Apply campaign filter (URL param)
  const campaignParam = searchParams.campaign
  const rowsWithCamp = rows.map(r => ({ ...r, campaignName: campaignNames.get(r.campaign_id) ?? `Campaign ${r.campaign_id}` }))

  // Group by campaign, sort by total spend desc
  const grouped = new Map<string, typeof rowsWithCamp>()
  for (const kw of rowsWithCamp) {
    if (!grouped.has(kw.campaignName)) grouped.set(kw.campaignName, [])
    grouped.get(kw.campaignName)!.push(kw)
  }
  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    b[1].reduce((s, k) => s + k.spend_cents, 0) - a[1].reduce((s, k) => s + k.spend_cents, 0)
  )
  const allCampaigns = sortedGroups.map(([name]) => name)

  // ── Fetch negatives ─────────────────────────────────────────────────────────
  const negKwTable  = adType === 'sb' ? 'sb_negative_keywords' : 'sp_negative_keywords'
  const [{ data: negKwRows }, { data: negTgtRows }] = activeProfileId ? await Promise.all([
    supabase.from(negKwTable).select('keyword_id, campaign_id, ad_group_id, keyword_text, match_type, state')
      .eq('profile_id', activeProfileId).range(0, 9999),
    adType === 'sp'
      ? supabase.from('sp_negative_targets').select('target_id, campaign_id, ad_group_id, expression, state')
          .eq('profile_id', activeProfileId).range(0, 9999)
      : Promise.resolve({ data: [] as any[] }),
  ]) : [{ data: [] }, { data: [] }]

  // Get campaign names for negatives
  const negCampIds = [...new Set([
    ...(negKwRows ?? []).map((r: any) => r.campaign_id),
    ...(negTgtRows?.data ?? negTgtRows ?? []).map((r: any) => r.campaign_id),
  ].filter(Boolean))]
  const { data: negCampRows } = negCampIds.length > 0
    ? await supabase.from(campTable).select('campaign_id, campaign_name')
        .eq('profile_id', activeProfileId!).in('campaign_id', negCampIds)
        .order('date', { ascending: false }).range(0, 4999)
    : { data: [] as any[] }
  const negCampNames = new Map<number, string>()
  for (const c of negCampRows ?? []) {
    if (!negCampNames.has(c.campaign_id)) negCampNames.set(c.campaign_id, c.campaign_name)
  }

  const negRows = [
    ...(negKwRows ?? []).map((r: any) => ({
      ...r, campaignName: negCampNames.get(r.campaign_id) ?? `Campaign ${r.campaign_id}`,
      level: r.ad_group_id ? 'Ad Group' : 'Campaign', type: 'keyword' as const,
    })),
    ...((negTgtRows as any)?.data ?? negTgtRows ?? []).map((r: any) => ({
      ...r, campaignName: negCampNames.get(r.campaign_id) ?? `Campaign ${r.campaign_id}`,
      level: r.ad_group_id ? 'Ad Group' : 'Campaign', type: 'target' as const,
    })),
  ]
  const negGrouped = new Map<string, typeof negRows>()
  for (const n of negRows) {
    if (!negGrouped.has(n.campaignName)) negGrouped.set(n.campaignName, [])
    negGrouped.get(n.campaignName)!.push(n)
  }
  const negSortedGroups = [...negGrouped.entries()]

  // ── URL builder ─────────────────────────────────────────────────────────────
  const buildUrl = (params: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = {
      profile_id: String(activeProfileId),
      days: isAllTime ? 'all' : String(days),
      adType, state: kwState !== 'all' ? kwState : undefined,
      start: searchParams.start, end: searchParams.end,
      tab: activeTab,
      ...params,
    }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`) .join('&')
    return `/dashboard/targeting?${qs}`
  }

  const tabCounts: Record<string, number> = {
    all: rows.length,
    keywords: rows.filter(r => TAB_TYPES.keywords.includes((r.match_type ?? '').toLowerCase())).length,
    products: rows.filter(r => TAB_TYPES.products.includes((r.match_type ?? '').toLowerCase())).length,
    auto: rows.filter(r => TAB_TYPES.auto.includes((r.match_type ?? '').toLowerCase())).length,
    negatives: negRows.length,
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
          {/* SP / SB */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {(['sp','sb'] as const).map(t => (
              <Link key={t} href={buildUrl({ adType: t, tab: 'all' })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  adType === t ? t === 'sp' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
                {t.toUpperCase()}
              </Link>
            ))}
          </div>
          {/* State */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {([['all','All'],['enabled','Enabled'],['paused','Paused'],['archived','Archived']] as const).map(([s, label]) => (
              <Link key={s} href={buildUrl({ state: s === 'all' ? undefined : s })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${kwState === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
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

      {/* Tab count pills (read-only summary) */}
      <div className="flex gap-3 text-xs text-gray-500">
        {Object.entries(tabCounts).filter(([k]) => k !== 'all' && (k !== 'auto' || adType === 'sp')).map(([k, n]) => (
          <span key={k} className="bg-white border border-gray-200 rounded-full px-3 py-1">
            <span className="capitalize">{k === 'products' ? 'Product Targets' : k === 'negatives' ? 'Negatives' : k === 'auto' ? 'Auto Targets' : k}</span>
            <span className="ml-1 font-semibold text-gray-700">{n}</span>
          </span>
        ))}
      </div>

      {/* Interactive table (Client Component) */}
      <TargetingTable
        adType={adType}
        tab={activeTab}
        activeTab={activeTab}
        sortedGroups={sortedGroups as any}
        negGroups={negSortedGroups as any}
        campaigns={allCampaigns}
        buildUrl={buildUrl}
      />
    </div>
  )
}
