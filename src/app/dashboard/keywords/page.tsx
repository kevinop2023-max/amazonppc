import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 0

function fmt$(cents: number) {
  return '$' + (cents / 100).toFixed(2)
}

function acosColor(acos: number | null) {
  if (acos === null) return 'text-gray-400'
  if (acos > 50) return 'text-red-600 font-semibold'
  if (acos < 25) return 'text-green-600 font-semibold'
  return 'text-amber-600 font-semibold'
}

export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; days?: string; filter?: string; adType?: string }
}) {
  const supabase  = await createClient()
  const { data: profiles } = await supabase
    .from('amazon_profiles')
    .select('profile_id, account_name, marketplace')
    .order('created_at')
    .limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  const days      = Number(searchParams.days ?? 30)
  const filter    = searchParams.filter ?? 'all'
  const adType    = (searchParams.adType ?? 'sp') as 'sp' | 'sb'

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString().split('T')[0]

  const activeProfileId = profileId ?? (profiles as any)?.[0]?.profile_id ?? null

  const kwTable   = adType === 'sb' ? 'sb_keywords'  : 'sp_keywords'
  const campTable = adType === 'sb' ? 'sb_campaigns' : 'sp_campaigns'

  // Round 1: keyword rows (add campaign_id for grouping)
  const { data: keywords } = activeProfileId
    ? await supabase
        .from(kwTable)
        .select('keyword_id, campaign_id, keyword_text, match_type, state, bid_cents, impressions, clicks, spend_cents, sales_cents, orders, date')
        .eq('profile_id', activeProfileId)
        .gte('date', startStr)
        .order('spend_cents', { ascending: false })
        .range(0, 49999)
    : { data: [] }

  // Aggregate by keyword_id
  const kwMap = new Map<number, any>()
  for (const row of (keywords ?? []) as any[]) {
    if (!kwMap.has(row.keyword_id)) {
      kwMap.set(row.keyword_id, {
        keyword_id:   row.keyword_id,
        campaign_id:  row.campaign_id,
        keyword_text: row.keyword_text,
        match_type:   row.match_type,
        state:        row.state,
        bid_cents:    row.bid_cents,
        impressions:  0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0,
      })
    }
    const kw = kwMap.get(row.keyword_id)
    kw.impressions  += row.impressions
    kw.clicks       += row.clicks
    kw.spend_cents  += row.spend_cents
    kw.sales_cents  += row.sales_cents
    kw.orders       += row.orders
  }

  let rows = Array.from(kwMap.values())

  // Apply filter
  if (filter === 'zero_impressions') rows = rows.filter(r => r.impressions === 0 && r.state === 'enabled')
  else if (filter === 'zero_sales')  rows = rows.filter(r => r.sales_cents === 0 && r.spend_cents > 1000)

  // Round 2: fetch campaign names for the found campaign IDs
  const campIds = [...new Set(rows.map(r => r.campaign_id).filter(Boolean))]
  const { data: campRows } = campIds.length > 0
    ? await supabase
        .from(campTable)
        .select('campaign_id, campaign_name')
        .eq('profile_id', activeProfileId)
        .in('campaign_id', campIds)
        .order('date', { ascending: false })
        .range(0, 4999)
    : { data: [] as { campaign_id: number; campaign_name: string }[] }

  const campaignNames = new Map<number, string>()
  for (const c of campRows ?? []) {
    if (!campaignNames.has(c.campaign_id)) campaignNames.set(c.campaign_id, c.campaign_name)
  }

  // Add campaign name to each row
  const rowsWithCampaign = rows.map(kw => ({
    ...kw,
    campaignName: campaignNames.get(kw.campaign_id) ?? `Campaign ${kw.campaign_id}`,
  }))

  // Group by campaign name, sort groups by total spend desc
  const grouped = new Map<string, typeof rowsWithCampaign>()
  for (const kw of rowsWithCampaign) {
    if (!grouped.has(kw.campaignName)) grouped.set(kw.campaignName, [])
    grouped.get(kw.campaignName)!.push(kw)
  }
  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    b[1].reduce((s, k) => s + k.spend_cents, 0) - a[1].reduce((s, k) => s + k.spend_cents, 0)
  )

  const filters = [
    { key: 'all',              label: 'All Keywords' },
    { key: 'zero_impressions', label: 'Zero Impressions' },
    { key: 'zero_sales',       label: 'No Sales (>$10 spend)' },
  ]

  const buildUrl = (params: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = {
      profile_id: String(activeProfileId),
      days:       String(days),
      filter,
      adType,
      ...params,
    }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
    return `/dashboard/keywords?${qs}`
  }

  const colCount = 10

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Keywords</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {rows.length} keywords · {sortedGroups.length} campaign{sortedGroups.length !== 1 ? 's' : ''} · {adType === 'sb' ? 'Sponsored Brands' : 'Sponsored Products'} · Last {days} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* SP / SB toggle */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {(['sp', 'sb'] as const).map(t => (
              <Link
                key={t}
                href={buildUrl({ adType: t })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  adType === t
                    ? t === 'sp' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                {t.toUpperCase()}
              </Link>
            ))}
          </div>
          {/* Day range */}
          {[7, 14, 30, 90].map(d => (
            <Link
              key={d}
              href={buildUrl({ days: String(d) })}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                days === d ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-orange-300'
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {filters.map(f => (
          <Link
            key={f.key}
            href={buildUrl({ filter: f.key })}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === f.key
                ? 'bg-orange-100 text-orange-700 border border-orange-200'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-orange-200 hover:text-orange-600'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {sortedGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-400 text-sm">No {adType.toUpperCase()} keyword data yet.</p>
            <p className="text-gray-400 text-xs mt-1">Run a sync from the Overview page to load your keyword data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Keyword', 'Match', 'State', 'Bid', 'Impr.', 'Clicks', 'Spend', 'Sales', 'Orders', 'ACOS'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map(([campaignName, groupKws]) => (
                  <>
                    {/* Campaign section header */}
                    <tr key={`h-${campaignName}`} className="bg-gray-50 border-y border-gray-100">
                      <td colSpan={colCount} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide truncate">{campaignName}</span>
                          <span className="text-[10px] text-gray-400 shrink-0 bg-gray-200 rounded px-1.5 py-0.5">
                            {groupKws.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {/* Keyword rows */}
                    {groupKws.map((kw: any) => {
                      const acos = kw.sales_cents > 0 ? (kw.spend_cents / kw.sales_cents * 100) : null
                      return (
                        <tr key={kw.keyword_id} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/30 transition-colors">
                          <td className="py-3 font-medium text-gray-900 max-w-[260px]">
                            <span className="block truncate pl-8 pr-4">{kw.keyword_text}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              kw.match_type === 'exact'  ? 'bg-blue-50 text-blue-700' :
                              kw.match_type === 'phrase' ? 'bg-purple-50 text-purple-700' :
                                                           'bg-gray-100 text-gray-600'
                            }`}>
                              {kw.match_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              kw.state === 'enabled' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                              {kw.state}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{kw.bid_cents ? fmt$(kw.bid_cents) : '—'}</td>
                          <td className="px-4 py-3 text-gray-700">{kw.impressions.toLocaleString()}</td>
                          <td className="px-4 py-3 text-gray-700">{kw.clicks.toLocaleString()}</td>
                          <td className="px-4 py-3 text-gray-700">{fmt$(kw.spend_cents)}</td>
                          <td className="px-4 py-3 text-gray-700">{fmt$(kw.sales_cents)}</td>
                          <td className="px-4 py-3 text-gray-700">{kw.orders}</td>
                          <td className={`px-4 py-3 ${acosColor(acos)}`}>
                            {acos !== null ? acos.toFixed(1) + '%' : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
