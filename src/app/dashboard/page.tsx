import { createClient } from '@/lib/supabase/server'
import MetricCard from '@/components/MetricCard'
import AlertsPanel from '@/components/AlertsPanel'
import ProfileSelector from '@/components/ProfileSelector'
import DateRangePicker from '@/components/DateRangePicker'
import Link from 'next/link'

export const revalidate = 0

function fmt$(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type CampRow = { campaign_id: number; campaign_name: string; spend_cents: number; sales_cents: number; orders: number }

function agg(rows: CampRow[]) {
  const ids = new Set<number>()
  let spend = 0, sales = 0, orders = 0
  for (const r of rows) {
    spend  += r.spend_cents ?? 0
    sales  += r.sales_cents ?? 0
    orders += r.orders      ?? 0
    ids.add(r.campaign_id)
  }
  return {
    spend, sales, orders, campaigns: ids.size,
    acos: sales > 0 ? (spend / sales * 100).toFixed(1) + '%' : '—',
    roas: spend > 0 ? (sales / spend).toFixed(2) + 'x' : '—',
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; days?: string; start?: string; end?: string; amazon_connected?: string; amazon_error?: string }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase
    .from('amazon_profiles')
    .select('profile_id, account_name, marketplace')
    .order('created_at')
    .limit(10)

  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id
    ? Number(searchParams.profile_id)
    : (usProfile ?? profiles?.[0])?.profile_id ?? null

  const days     = Number(searchParams.days ?? 30)
  const startStr = searchParams.start ?? dateStr(days)
  const endStr   = searchParams.end   ?? dateStr(1)
  const isCustomRange = !!(searchParams.start && searchParams.end)

  // Period comparison halves
  const startMs         = new Date(startStr + 'T00:00:00Z').getTime()
  const endMs           = new Date(endStr   + 'T00:00:00Z').getTime()
  const midMs           = Math.floor((startMs + endMs) / 2)
  const firstHalfEnd    = new Date(midMs).toISOString().split('T')[0]
  const secondHalfStart = new Date(midMs + 86400000).toISOString().split('T')[0]
  const showComparison  = secondHalfStart <= endStr && firstHalfEnd !== endStr

  // ── No profile connected ────────────────────────────────────────────────
  if (!profileId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65vh] text-center px-4">
        <div className="w-20 h-20 bg-orange-50 border border-orange-100 rounded-3xl flex items-center justify-center mb-6">
          <svg className="w-9 h-9 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Connect your Amazon Ads account</h2>
        <p className="text-sm text-gray-500 mb-8 max-w-md">
          Authorize PPC Analytics to read your Sponsored Products, Sponsored Brands, and search term data. Data syncs automatically every day.
        </p>
        <a
          href="/api/auth/amazon"
          className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-7 py-3 rounded-xl transition-colors shadow-sm text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Connect Amazon Ads
        </a>
        {searchParams.amazon_error && (
          <p className="text-sm text-red-600 mt-4 bg-red-50 border border-red-100 px-4 py-2 rounded-xl">
            Error: {searchParams.amazon_error.replace(/_/g, ' ')}
          </p>
        )}
      </div>
    )
  }

  // ── Fetch all data in parallel ──────────────────────────────────────────
  const fhPromise = showComparison
    ? supabase.rpc('get_overview_metrics', { p_profile_id: profileId, p_start: startStr, p_end: firstHalfEnd })
    : Promise.resolve({ data: null } as any)
  const shPromise = showComparison
    ? supabase.rpc('get_overview_metrics', { p_profile_id: profileId, p_start: secondHalfStart, p_end: endStr })
    : Promise.resolve({ data: null } as any)

  const [metricsRes, alertsRes, spRes, sbRes, fhRes, shRes] = await Promise.all([
    supabase.rpc('get_overview_metrics', { p_profile_id: profileId, p_start: startStr, p_end: endStr }),
    supabase.from('alerts').select('id, alert_type, severity, entity_name, message, triggered_at').eq('profile_id', profileId).is('dismissed_at', null).order('triggered_at', { ascending: false }).limit(5),
    supabase.from('sp_campaigns').select('campaign_id, campaign_name, spend_cents, sales_cents, orders').eq('profile_id', profileId).gte('date', startStr).lte('date', endStr).range(0, 49999),
    supabase.from('sb_campaigns').select('campaign_id, campaign_name, spend_cents, sales_cents, orders').eq('profile_id', profileId).gte('date', startStr).lte('date', endStr).range(0, 49999),
    fhPromise,
    shPromise,
  ])

  // ── Main totals ─────────────────────────────────────────────────────────
  const m = metricsRes.data?.[0]
  const totals = {
    spend:       Number(m?.spend_cents  ?? 0),
    sales:       Number(m?.sales_cents  ?? 0),
    orders:      Number(m?.orders       ?? 0),
    impressions: Number(m?.impressions  ?? 0),
    clicks:      Number(m?.clicks       ?? 0),
  }
  const acos = totals.sales > 0  ? (totals.spend / totals.sales * 100).toFixed(1) + '%' : '—'
  const roas = totals.spend > 0  ? (totals.sales / totals.spend).toFixed(2) + 'x'       : '—'
  const cpc  = totals.clicks > 0 ? '$' + (totals.spend / totals.clicks / 100).toFixed(2) : '—'
  const acosHighlight = totals.sales > 0
    ? totals.spend / totals.sales > 0.5 ? 'red' as const
    : totals.spend / totals.sales < 0.25 ? 'green' as const
    : 'default' as const
    : 'default' as const

  // ── SP / SB breakdown ───────────────────────────────────────────────────
  const sp = agg(spRes.data ?? [])
  const sb = agg(sbRes.data ?? [])

  // ── Period comparison ───────────────────────────────────────────────────
  const p1m = (fhRes as any)?.data?.[0]
  const p2m = (shRes as any)?.data?.[0]
  const p1 = p1m ? { spend: Number(p1m.spend_cents ?? 0), sales: Number(p1m.sales_cents ?? 0), orders: Number(p1m.orders ?? 0) } : null
  const p2 = p2m ? { spend: Number(p2m.spend_cents ?? 0), sales: Number(p2m.sales_cents ?? 0), orders: Number(p2m.orders ?? 0) } : null

  // ── Orders by campaign ──────────────────────────────────────────────────
  type CampEntry = { name: string; type: string; spend: number; sales: number; orders: number }
  const campMap = new Map<string, CampEntry>()
  for (const r of spRes.data ?? []) {
    const key = `SP-${r.campaign_id}`
    if (!campMap.has(key)) campMap.set(key, { name: r.campaign_name, type: 'SP', spend: 0, sales: 0, orders: 0 })
    const c = campMap.get(key)!; c.spend += r.spend_cents; c.sales += r.sales_cents; c.orders += r.orders ?? 0
  }
  for (const r of sbRes.data ?? []) {
    const key = `SB-${r.campaign_id}`
    if (!campMap.has(key)) campMap.set(key, { name: r.campaign_name, type: 'SB', spend: 0, sales: 0, orders: 0 })
    const c = campMap.get(key)!; c.spend += r.spend_cents; c.sales += r.sales_cents; c.orders += r.orders ?? 0
  }
  const allCamps = Array.from(campMap.values())
  const totalCampOrders = allCamps.reduce((s, c) => s + c.orders, 0)
  const topCamps = allCamps.filter(c => c.orders > 0).sort((a, b) => b.orders - a.orders).slice(0, 10)

  const dayOptions = [7, 14, 30, 60]

  // ── Change indicator helper ─────────────────────────────────────────────
  function chg(from: number, to: number, higherIsBetter: boolean) {
    if (from === 0) return null
    const pct = (to - from) / from * 100
    const good = higherIsBetter ? pct > 0 : pct < 0
    const bad  = higherIsBetter ? pct < 0 : pct > 0
    return { pct, cls: good ? 'text-emerald-600' : bad ? 'text-red-500' : 'text-gray-400', arrow: pct >= 0 ? '↑' : '↓' }
  }

  const typeColors: Record<string, string> = {
    SP: 'bg-blue-50 text-blue-600',
    SB: 'bg-purple-50 text-purple-600',
  }

  return (
    <div className="space-y-7">

      {/* ── Header ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Overview</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {isCustomRange ? `${startStr} — ${endStr}` : `Last ${days} days`}
            </p>
          </div>
          {profiles && profiles.length > 0 && (
            <ProfileSelector profiles={profiles} currentProfileId={profileId} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {dayOptions.map(d => (
              <Link
                key={d}
                href={`/dashboard?profile_id=${profileId}&days=${d}`}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  !isCustomRange && days === d
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                {d}d
              </Link>
            ))}
          </div>
          <DateRangePicker start={startStr} end={endStr} />
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard label="Total Spend"  value={fmt$(totals.spend)} />
        <MetricCard label="Total Sales"  value={fmt$(totals.sales)} />
        <MetricCard label="ACOS"         value={acos} highlight={acosHighlight} />
        <MetricCard label="ROAS"         value={roas} highlight={totals.sales / Math.max(totals.spend, 1) >= 3 ? 'green' : 'default'} />
        <MetricCard label="Orders"       value={totals.orders.toLocaleString()} />
        <MetricCard label="Avg CPC"      value={cpc} />
      </div>
      <p className="text-xs text-gray-400 -mt-3">
        Includes SP + SB. Small variance vs Amazon Ads is normal — attribution data updates over 48–72h.
      </p>

      {/* ── Campaign Performance Breakdown ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Campaign Performance Breakdown</h2>
          <span className="text-xs text-gray-400">{fmtDate(startStr)} – {fmtDate(endStr)}</span>
        </div>
        <div className="p-5 grid grid-cols-2 divide-x divide-gray-50">
          {([
            { label: 'Sponsored Products (SP)', dot: 'bg-blue-500',   data: sp },
            { label: 'Sponsored Brands (SB)',   dot: 'bg-purple-500', data: sb },
          ] as const).map(({ label, dot, data }) => (
            <div key={label} className="first:pr-6 last:pl-6">
              <div className="flex items-center gap-1.5 mb-3.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <span className="text-xs font-semibold text-gray-700">{label}</span>
              </div>
              {[
                { l: 'Spend',     v: fmt$(data.spend) },
                { l: 'Sales',     v: fmt$(data.sales) },
                { l: 'Orders',    v: data.orders.toLocaleString() },
                { l: 'ACoS',      v: data.acos },
                { l: 'ROAS',      v: data.roas },
                { l: 'Campaigns', v: data.campaigns.toString() },
              ].map(row => (
                <div key={row.l} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-400">{row.l}</span>
                  <span className="text-xs font-medium text-gray-900">{row.v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Period Comparison ── */}
      {showComparison && p1 && p2 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Period Comparison</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {fmtDate(startStr)} – {fmtDate(firstHalfEnd)} &nbsp;vs&nbsp; {fmtDate(secondHalfStart)} – {fmtDate(endStr)}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50/50">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Metric</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{fmtDate(startStr)} – {fmtDate(firstHalfEnd)}</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{fmtDate(secondHalfStart)} – {fmtDate(endStr)}</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Change</th>
              </tr>
            </thead>
            <tbody>
              {[
                { l: 'Spend',  v1: fmt$(p1.spend),  v2: fmt$(p2.spend),  c: chg(p1.spend, p2.spend, false) },
                { l: 'Sales',  v1: fmt$(p1.sales),  v2: fmt$(p2.sales),  c: chg(p1.sales, p2.sales, true)  },
                { l: 'Orders', v1: p1.orders.toLocaleString(), v2: p2.orders.toLocaleString(), c: chg(p1.orders, p2.orders, true) },
                {
                  l: 'ACoS',
                  v1: p1.sales > 0 ? (p1.spend / p1.sales * 100).toFixed(1) + '%' : '—',
                  v2: p2.sales > 0 ? (p2.spend / p2.sales * 100).toFixed(1) + '%' : '—',
                  c:  chg(p1.sales > 0 ? p1.spend / p1.sales : 0, p2.sales > 0 ? p2.spend / p2.sales : 0, false),
                },
              ].map(row => (
                <tr key={row.l} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3 text-xs font-medium text-gray-500">{row.l}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500 tabular-nums">{row.v1}</td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900 tabular-nums">{row.v2}</td>
                  <td className="px-5 py-3 text-right text-xs tabular-nums">
                    {row.c
                      ? <span className={row.c.cls}>{row.c.arrow} {Math.abs(row.c.pct).toFixed(0)}%</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Orders by Campaign ── */}
      {topCamps.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Orders by Campaign</h2>
            <span className="text-xs text-gray-400">sorted by orders</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Campaign</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Orders</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Sales</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Spend</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">ACoS</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Share</th>
                </tr>
              </thead>
              <tbody>
                {topCamps.map((c, i) => {
                  const campAcos = c.sales > 0 ? (c.spend / c.sales * 100).toFixed(1) + '%' : '—'
                  const share = totalCampOrders > 0 ? Math.round(c.orders / totalCampOrders * 100) : 0
                  return (
                    <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3 text-xs font-medium text-gray-900 max-w-[220px] truncate" title={c.name}>{c.name}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${typeColors[c.type] ?? ''}`}>{c.type}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 tabular-nums">{c.orders}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600 tabular-nums">{fmt$(c.sales)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600 tabular-nums">{fmt$(c.spend)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular-nums">{campAcos}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 bg-gray-100 rounded-full h-1.5 hidden sm:block">
                            <div className="bg-orange-400 h-1.5 rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums">{share}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Alerts ── */}
      <AlertsPanel alerts={alertsRes.data ?? []} />

      {/* ── Quick links ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { href: `/dashboard/campaigns?profile_id=${profileId}&days=${days}`,       title: 'Campaign Table',  desc: 'Full metrics for every campaign',         icon: '◈' },
          { href: `/dashboard/search-terms?profile_id=${profileId}&mode=wasted`,     title: 'Wasted Spend',    desc: 'Search terms burning budget with no sales', icon: '💸' },
          { href: `/dashboard/search-terms?profile_id=${profileId}&mode=converters`, title: 'Harvest to Exact',desc: 'Converting terms ready to promote',         icon: '🌟' },
          { href: `/dashboard/data-sync?profile_id=${profileId}`,                    title: 'Data Sync',       desc: 'Sync Amazon data and view history',         icon: '↺' },
        ].map(card => (
          <Link
            key={card.href}
            href={card.href}
            className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:border-orange-200 transition-all group"
          >
            <div className="text-2xl mb-3">{card.icon}</div>
            <p className="font-semibold text-gray-900 text-sm group-hover:text-orange-600 transition-colors">{card.title}</p>
            <p className="text-xs text-gray-400 mt-1">{card.desc}</p>
          </Link>
        ))}
      </div>

    </div>
  )
}
