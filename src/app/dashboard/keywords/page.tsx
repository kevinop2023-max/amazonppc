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
  searchParams: { profile_id?: string; days?: string; filter?: string }
}) {
  const supabase   = await createClient()
  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, marketplace').order('created_at').limit(10)
  const usProfile  = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId  = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  const days       = Number(searchParams.days ?? 30)
  const filter     = searchParams.filter ?? 'all'

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString().split('T')[0]

  const { data: profiles } = await supabase
    .from('amazon_profiles')
    .select('profile_id, account_name')
    .order('created_at')
    .limit(10)

  const activeProfileId = profileId ?? (profiles as any)?.[0]?.profile_id ?? null

  const { data: keywords } = activeProfileId
    ? await supabase
        .from('sp_keywords')
        .select('keyword_id, keyword_text, match_type, state, bid_cents, impressions, clicks, spend_cents, sales_cents, orders, date')
        .eq('profile_id', activeProfileId)
        .gte('date', startStr)
        .order('spend_cents', { ascending: false })
        .limit(500)
    : { data: [] }

  // Aggregate by keyword_id
  const kwMap = new Map<number, any>()
  for (const row of (keywords ?? []) as any[]) {
    if (!kwMap.has(row.keyword_id)) {
      kwMap.set(row.keyword_id, {
        keyword_id:   row.keyword_id,
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
  if (filter === 'zero_impressions') {
    rows = rows.filter(r => r.impressions === 0 && r.state === 'enabled')
  } else if (filter === 'zero_sales') {
    rows = rows.filter(r => r.sales_cents === 0 && r.spend_cents > 1000)
  }

  const filters = [
    { key: 'all',             label: 'All Keywords' },
    { key: 'zero_impressions', label: 'Zero Impressions' },
    { key: 'zero_sales',       label: 'No Sales (>$10 spend)' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Keywords</h1>
          <p className="text-sm text-gray-400 mt-0.5">Sponsored Products keyword performance · Last {days} days</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map(d => (
            <Link
              key={d}
              href={`/dashboard/keywords?profile_id=${activeProfileId}&days=${d}&filter=${filter}`}
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
            href={`/dashboard/keywords?profile_id=${activeProfileId}&days=${days}&filter=${f.key}`}
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
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-400 text-sm">No keyword data yet.</p>
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
              <tbody className="divide-y divide-gray-50">
                {rows.map((kw: any) => {
                  const acos = kw.sales_cents > 0 ? (kw.spend_cents / kw.sales_cents * 100) : null
                  return (
                    <tr key={kw.keyword_id} className="hover:bg-orange-50/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[260px] truncate">{kw.keyword_text}</td>
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
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
