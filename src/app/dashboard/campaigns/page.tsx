import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

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
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
      type === 'SP' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
    }`}>
      {type}
    </span>
  )
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; days?: string; type?: string; state?: string }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id').order('created_at').limit(1)
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : profiles?.[0]?.profile_id ?? null
  const days  = Number(searchParams.days ?? 30)
  const type  = searchParams.type
  const state = searchParams.state

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  const startStr = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

  async function fetchCampaigns(table: 'sp_campaigns' | 'sb_campaigns', adType: string) {
    let q = supabase
      .from(table)
      .select('campaign_id, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId!)
      .gte('date', startStr)
    if (state) q = q.eq('state', state)
    const { data } = await q

    const map = new Map<number, { campaign_id: number; name: string; state: string; ad_type: string; budget: number | null; spend: number; sales: number; orders: number; impressions: number; clicks: number }>()
    for (const r of data ?? []) {
      if (!map.has(r.campaign_id)) {
        map.set(r.campaign_id, { campaign_id: r.campaign_id, name: r.campaign_name, state: r.state, ad_type: adType, budget: r.daily_budget_cents, spend: 0, sales: 0, orders: 0, impressions: 0, clicks: 0 })
      }
      const c = map.get(r.campaign_id)!
      c.spend      += r.spend_cents
      c.sales      += r.sales_cents
      c.orders     += r.orders
      c.impressions += r.impressions
      c.clicks     += r.clicks
    }
    return Array.from(map.values())
  }

  const results = await Promise.all([
    ...(!type || type === 'SP' ? [fetchCampaigns('sp_campaigns', 'SP')] : []),
    ...(!type || type === 'SB' ? [fetchCampaigns('sb_campaigns', 'SB')] : []),
  ])

  const campaigns = results.flat()
    .map(c => ({
      ...c,
      acos: c.sales > 0  ? Math.round(c.spend / c.sales * 1000) / 10 : null,
      roas: c.spend > 0  ? Math.round(c.sales / c.spend * 100) / 100  : null,
      cpc:  c.clicks > 0 ? c.spend / c.clicks / 100                   : null,
      ctr:  c.impressions > 0 ? Math.round(c.clicks / c.impressions * 10000) / 100 : null,
    }))
    .sort((a, b) => b.spend - a.spend)

  const totalSpend  = campaigns.reduce((s, c) => s + c.spend, 0)
  const totalSales  = campaigns.reduce((s, c) => s + c.sales, 0)
  const totalOrders = campaigns.reduce((s, c) => s + c.orders, 0)

  const buildUrl = (params: Record<string, string | undefined>) => {
    const base = { profile_id: String(profileId), days: String(days), type, state, ...params }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
    return `/dashboard/campaigns?${qs}`
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-400 mt-0.5">{campaigns.length} campaigns · {days}d</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Type filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {[['', 'All'], ['SP', 'SP'], ['SB', 'SB']].map(([t, label]) => (
              <Link key={t} href={buildUrl({ type: t || undefined, days: String(days) })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  (type ?? '') === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{label}</Link>
            ))}
          </div>
          {/* Days filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {[7, 30, 90].map(d => (
              <Link key={d} href={buildUrl({ days: String(d) })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  days === d ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{d}d</Link>
            ))}
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Spend', value: '$' + (totalSpend / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
          { label: 'Total Sales', value: '$' + (totalSales / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
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
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Spend</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Sales</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">ACOS</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">ROAS</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Orders</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Clicks</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">CPC</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">CTR</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center text-sm text-gray-400">
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
