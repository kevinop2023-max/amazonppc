import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import DateRangePicker from '@/components/DateRangePicker'

export const revalidate = 0

function AcosBadge({ acos }: { acos: number | null }) {
  if (acos === null) return <span className="text-xs text-gray-300">—</span>
  const cls =
    acos < 25 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    acos < 50 ? 'bg-amber-50 text-amber-700 border-amber-200'       :
                'bg-red-50 text-red-600 border-red-200'
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-lg border ${cls}`}>
      {acos}%
    </span>
  )
}

function AdTypePill({ type }: { type: string }) {
  const cls =
    type === 'SP' ? 'bg-blue-50 text-blue-600'   :
    type === 'SB' ? 'bg-purple-50 text-purple-600' :
                   'bg-teal-50 text-teal-600'
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${cls}`}>
      {type}
    </span>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: string }) {
  if (!active) return <span className="text-gray-300 ml-0.5">↕</span>
  return <span className="ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>
}

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

type SortKey = 'spend' | 'sales' | 'acos' | 'roas' | 'orders' | 'impressions' | 'clicks' | 'cpc' | 'ctr'

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; days?: string; start?: string; end?: string; type?: string; state?: string; sort?: string; dir?: string }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  const days     = Number(searchParams.days ?? 30)
  const type     = searchParams.type
  const state    = searchParams.state
  const sortKey  = (searchParams.sort ?? 'spend') as SortKey
  const sortDir  = searchParams.dir ?? 'desc'
  const isCustom = !!(searchParams.start && searchParams.end)
  const startStr = searchParams.start ?? dateStr(days)
  const endStr   = searchParams.end   ?? dateStr(1)

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  async function fetchCampaigns(table: 'sp_campaigns' | 'sb_campaigns' | 'sd_campaigns', adType: string) {
    // Two parallel queries: meta (all-time, for current state) + perf (date-range only)
    // Paused/archived campaigns have no rows in recent date ranges, so state must be
    // resolved from the most recent historical row, not filtered in the perf query.
    const [{ data: metaRows }, { data: perfRows }] = await Promise.all([
      supabase
        .from(table)
        .select('campaign_id, campaign_name, state, daily_budget_cents')
        .eq('profile_id', profileId!)
        .order('date', { ascending: false })
        .range(0, 49999),
      supabase
        .from(table)
        .select('campaign_id, spend_cents, sales_cents, orders, impressions, clicks')
        .eq('profile_id', profileId!)
        .gte('date', startStr)
        .lte('date', endStr)
        .range(0, 49999),
    ])

    // Most-recent state/name/budget per campaign (metaRows ordered date DESC)
    const metaMap = new Map<number, { name: string; state: string; budget: number | null }>()
    for (const r of metaRows ?? []) {
      if (!metaMap.has(r.campaign_id)) {
        metaMap.set(r.campaign_id, { name: r.campaign_name, state: (r.state ?? 'enabled').toLowerCase(), budget: r.daily_budget_cents })
      }
    }

    // Aggregate performance within selected date range
    const perfMap = new Map<number, { spend: number; sales: number; orders: number; impressions: number; clicks: number }>()
    for (const r of perfRows ?? []) {
      if (!perfMap.has(r.campaign_id)) {
        perfMap.set(r.campaign_id, { spend: 0, sales: 0, orders: 0, impressions: 0, clicks: 0 })
      }
      const p = perfMap.get(r.campaign_id)!
      p.spend       += r.spend_cents
      p.sales       += r.sales_cents
      p.orders      += r.orders
      p.impressions += r.impressions
      p.clicks      += r.clicks
    }

    return Array.from(metaMap.entries())
      .filter(([, m]) => !state || m.state === state)
      .map(([id, m]) => {
        const p = perfMap.get(id) ?? { spend: 0, sales: 0, orders: 0, impressions: 0, clicks: 0 }
        return { campaign_id: id, name: m.name, state: m.state, ad_type: adType, budget: m.budget, ...p }
      })
  }

  const results = await Promise.all([
    ...(!type || type === 'SP' ? [fetchCampaigns('sp_campaigns', 'SP')] : []),
    ...(!type || type === 'SB' ? [fetchCampaigns('sb_campaigns', 'SB')] : []),
    ...(!type || type === 'SD' ? [fetchCampaigns('sd_campaigns', 'SD')] : []),
  ])

  const campaigns = results.flat()
    .map(c => ({
      ...c,
      acos: c.sales > 0       ? Math.round(c.spend / c.sales * 1000) / 10          : null,
      roas: c.spend > 0       ? Math.round(c.sales / c.spend * 100) / 100           : null,
      cpc:  c.clicks > 0      ? c.spend / c.clicks / 100                            : null,
      ctr:  c.impressions > 0 ? Math.round(c.clicks / c.impressions * 10000) / 100 : null,
    }))
    .sort((a, b) => {
      const aVal = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bVal = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

  const totalSpend  = campaigns.reduce((s, c) => s + c.spend, 0)
  const totalSales  = campaigns.reduce((s, c) => s + c.sales, 0)
  const totalOrders = campaigns.reduce((s, c) => s + c.orders, 0)

  const buildUrl = (params: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = {
      profile_id: String(profileId),
      type,
      state,
      start: searchParams.start,
      end: searchParams.end,
      days: String(days),
      sort: sortKey,
      dir: sortDir,
      ...params,
    }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
    return `/dashboard/campaigns?${qs}`
  }

  function sortUrl(col: SortKey) {
    const newDir = sortKey === col && sortDir === 'desc' ? 'asc' : 'desc'
    return buildUrl({ sort: col, dir: newDir })
  }

  const cols: { key: SortKey; label: string }[] = [
    { key: 'spend',       label: 'Spend'   },
    { key: 'sales',       label: 'Sales'   },
    { key: 'acos',        label: 'ACOS'    },
    { key: 'roas',        label: 'ROAS'    },
    { key: 'orders',      label: 'Orders'  },
    { key: 'impressions', label: 'Impr.'   },
    { key: 'clicks',      label: 'Clicks'  },
    { key: 'cpc',         label: 'CPC'     },
    { key: 'ctr',         label: 'CTR'     },
  ]

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {campaigns.length} campaigns · {isCustom ? `${startStr} – ${endStr}` : `${days}d`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Ad type filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {[['', 'All'], ['SP', 'SP'], ['SB', 'SB'], ['SD', 'SD']].map(([t, label]) => (
              <Link key={t} href={buildUrl({ type: t || undefined })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  (type ?? '') === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{label}</Link>
            ))}
          </div>
          {/* State filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {([['', 'All'], ['enabled', 'Enabled'], ['paused', 'Paused'], ['archived', 'Archived']] as const).map(([s, label]) => (
              <Link key={s} href={buildUrl({ state: s || undefined })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  (state ?? '') === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{label}</Link>
            ))}
          </div>
          {/* Days filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {[7, 14, 30, 60].map(d => (
              <Link key={d} href={buildUrl({ days: String(d), start: undefined, end: undefined })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  !isCustom && days === d ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{d}d</Link>
            ))}
          </div>
          {/* Custom date range */}
          <Suspense fallback={null}>
            <DateRangePicker start={startStr} end={endStr} basePath="/dashboard/campaigns" />
          </Suspense>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Spend',  value: '$' + (totalSpend / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
          { label: 'Total Sales',  value: '$' + (totalSales / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
          { label: 'Total Orders', value: totalOrders.toLocaleString() },
          { label: 'Blended ACOS', value: totalSales > 0 ? (totalSpend / totalSales * 100).toFixed(1) + '%' : '—' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm text-center">
            <p className="text-xs text-gray-400 font-medium">{s.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Campaign</th>
                {cols.map(col => (
                  <th key={col.key} className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    <Link href={sortUrl(col.key)} className={`inline-flex items-center justify-end gap-0.5 hover:text-gray-700 transition-colors ${sortKey === col.key ? 'text-gray-700' : ''}`}>
                      {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-16 text-center text-sm text-gray-400">
                    No campaign data for this period. Sync your account to get started.
                  </td>
                </tr>
              ) : campaigns.map(c => (
                <tr key={c.campaign_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2 max-w-xs">
                      <AdTypePill type={c.ad_type} />
                      <span className="font-medium text-gray-900 truncate text-sm" title={c.name}>{c.name}</span>
                      {c.state !== 'enabled' && (
                        <span className="text-[10px] text-gray-400 shrink-0">({c.state})</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right font-semibold text-gray-900 text-sm tabular-nums">
                    ${(c.spend / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3.5 text-right text-gray-600 text-sm tabular-nums">
                    ${(c.sales / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3.5 text-right"><AcosBadge acos={c.acos} /></td>
                  <td className={`px-4 py-3.5 text-right text-sm font-medium tabular-nums ${c.roas !== null && c.roas >= 3 ? 'text-emerald-600' : 'text-gray-600'}`}>
                    {c.roas !== null ? `${c.roas}x` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right text-gray-600 text-sm tabular-nums">{c.orders.toLocaleString()}</td>
                  <td className="px-4 py-3.5 text-right text-gray-500 text-sm tabular-nums">{c.impressions.toLocaleString()}</td>
                  <td className="px-4 py-3.5 text-right text-gray-600 text-sm tabular-nums">{c.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3.5 text-right text-gray-500 text-sm tabular-nums">
                    {c.cpc !== null ? `$${c.cpc.toFixed(2)}` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right text-gray-400 text-sm tabular-nums">
                    {c.ctr !== null ? `${c.ctr}%` : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
