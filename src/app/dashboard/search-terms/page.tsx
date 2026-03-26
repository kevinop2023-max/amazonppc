import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 0

export default async function SearchTermsPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; days?: string; mode?: string; min_spend?: string }
}) {
  const supabase  = await createClient()
  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  const days      = Number(searchParams.days ?? 14)
  const mode      = (searchParams.mode ?? 'all') as 'all' | 'wasted' | 'converters'
  const minSpend  = Number(searchParams.min_spend ?? 5)

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  const startStr = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

  const { data: rows } = await supabase
    .from('sp_search_terms')
    .select('customer_search_term, impressions, clicks, spend_cents, sales_cents, orders')
    .eq('profile_id', profileId)
    .gte('date', startStr)

  const map = new Map<string, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>()
  for (const r of rows ?? []) {
    if (!map.has(r.customer_search_term))
      map.set(r.customer_search_term, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 })
    const a = map.get(r.customer_search_term)!
    a.spend      += r.spend_cents
    a.sales      += r.sales_cents
    a.orders     += r.orders
    a.clicks     += r.clicks
    a.impressions += r.impressions
  }

  let terms = Array.from(map.entries()).map(([term, t]) => ({
    term,
    spend:  t.spend / 100,
    sales:  t.sales / 100,
    orders: t.orders,
    clicks: t.clicks,
    acos:   t.sales > 0  ? Math.round(t.spend / t.sales * 1000) / 10 : null,
    roas:   t.spend > 0  ? Math.round(t.sales / t.spend * 100) / 100 : null,
    cvr:    t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : null,
  }))

  if (mode === 'wasted')     terms = terms.filter(t => t.sales === 0 && t.spend >= minSpend).sort((a, b) => b.spend - a.spend)
  else if (mode === 'converters') terms = terms.filter(t => t.orders >= 2 && t.acos !== null && t.acos <= 15).sort((a, b) => b.orders - a.orders)
  else terms.sort((a, b) => b.spend - a.spend)

  const totalWaste = mode === 'wasted' ? terms.reduce((s, t) => s + t.spend, 0) : null

  const modes = [
    { key: 'all',        label: 'All Terms',   icon: '⊞' },
    { key: 'wasted',     label: 'Wasted Spend', icon: '🗑' },
    { key: 'converters', label: 'Converters',   icon: '⭐' },
  ]

  const buildUrl = (m: string) =>
    `/dashboard/search-terms?profile_id=${profileId}&days=${days}&mode=${m}&min_spend=${minSpend}`

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Search Terms</h1>
          <p className="text-sm text-gray-400 mt-0.5">{terms.length} terms · last {days} days</p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
          {modes.map(m => (
            <Link key={m.key} href={buildUrl(m.key)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                mode === m.key
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span>{m.icon}</span>{m.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Wasted spend banner */}
      {totalWaste !== null && totalWaste > 0 && (
        <div className="flex items-center gap-4 bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0 text-lg">💸</div>
          <div>
            <p className="font-bold text-red-800 text-sm">${totalWaste.toFixed(2)} wasted over {days} days</p>
            <p className="text-xs text-red-600 mt-0.5">
              {terms.length} search term{terms.length !== 1 ? 's' : ''} with over ${minSpend} spend and zero sales. Add these as negative keywords.
            </p>
          </div>
        </div>
      )}

      {/* Converters banner */}
      {mode === 'converters' && terms.length > 0 && (
        <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0 text-lg">⭐</div>
          <div>
            <p className="font-bold text-emerald-800 text-sm">{terms.length} high-converting search terms</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              ACOS ≤ 15% with 2+ orders. Move these to Exact Match campaigns for better control.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Search Term</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Spend</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Sales</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">ACOS</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Orders</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Clicks</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">CVR</th>
                {mode === 'wasted' && (
                  <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {terms.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-sm text-gray-400">
                    {mode === 'wasted' ? `No search terms with >${minSpend} spend and zero sales.` :
                     mode === 'converters' ? 'No converting terms with ACOS ≤ 15% and 2+ orders.' :
                     'No search term data for this period.'}
                  </td>
                </tr>
              ) : terms.map((t, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-gray-900 max-w-xs">
                    <span className="truncate block" title={t.term}>{t.term}</span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-semibold text-gray-900 tabular-nums">${t.spend.toFixed(2)}</td>
                  <td className="px-4 py-3.5 text-right text-gray-600 tabular-nums">${t.sales.toFixed(2)}</td>
                  <td className="px-4 py-3.5 text-right">
                    {t.acos !== null ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg border ${
                        t.acos < 25 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        t.acos < 50 ? 'bg-amber-50 text-amber-700 border-amber-200'       :
                                      'bg-red-50 text-red-600 border-red-200'
                      }`}>
                        {t.acos}%
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right text-gray-600 tabular-nums">{t.orders}</td>
                  <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums">{t.clicks}</td>
                  <td className="px-4 py-3.5 text-right text-gray-400 tabular-nums">
                    {t.cvr !== null ? `${t.cvr}%` : <span className="text-gray-300">—</span>}
                  </td>
                  {mode === 'wasted' && (
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-red-100 transition-colors">
                        + Negative
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
