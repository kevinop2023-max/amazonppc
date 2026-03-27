import { createClient } from '@/lib/supabase/server'
import MetricCard from '@/components/MetricCard'
import SyncStatus from '@/components/SyncStatus'
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

  // Date range: custom start/end overrides days buttons
  const days     = Number(searchParams.days ?? 30)
  const startStr = searchParams.start ?? dateStr(days)
  const endStr   = searchParams.end   ?? dateStr(0)

  const isCustomRange = !!(searchParams.start && searchParams.end)

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

  // ── Fetch data ──────────────────────────────────────────────────────────
  const [metricsRes, syncRes, alertsRes] = await Promise.all([
    supabase.rpc('get_overview_metrics', {
      p_profile_id: profileId,
      p_start:      startStr,
      p_end:        endStr,
    }),
    supabase
      .from('sync_logs')
      .select('id, status, started_at, completed_at, error_message, records_upserted')
      .eq('profile_id', profileId)
      .order('started_at', { ascending: false })
      .limit(4),
    supabase
      .from('alerts')
      .select('id, alert_type, severity, entity_name, message, triggered_at')
      .eq('profile_id', profileId)
      .is('dismissed_at', null)
      .order('triggered_at', { ascending: false })
      .limit(5),
  ])

  // Build a single sync log: sum records from the same sync session (batches within 5 min of latest)
  const syncLogs = syncRes.data ?? []
  const latestLog = syncLogs[0] ?? null
  const sessionCutoff = latestLog?.started_at
    ? new Date(new Date(latestLog.started_at).getTime() - 5 * 60 * 1000)
    : null
  const sessionRecords = sessionCutoff
    ? syncLogs
        .filter(l => l.status === 'success' && l.started_at && new Date(l.started_at) >= sessionCutoff)
        .reduce((s, l) => s + (l.records_upserted ?? 0), 0)
    : 0
  const syncForDisplay = latestLog
    ? { ...latestLog, records_upserted: sessionRecords || latestLog.records_upserted }
    : null

  const m = metricsRes.data?.[0]
  const totals = {
    spend:       Number(m?.spend_cents  ?? 0),
    sales:       Number(m?.sales_cents  ?? 0),
    orders:      Number(m?.orders       ?? 0),
    impressions: Number(m?.impressions  ?? 0),
    clicks:      Number(m?.clicks       ?? 0),
  }

  const acos  = totals.sales > 0  ? (totals.spend / totals.sales * 100).toFixed(1) + '%' : '—'
  const roas  = totals.spend > 0  ? (totals.sales / totals.spend).toFixed(2) + 'x'       : '—'
  const cpc   = totals.clicks > 0 ? '$' + (totals.spend / totals.clicks / 100).toFixed(2) : '—'

  const acosHighlight = totals.sales > 0
    ? totals.spend / totals.sales > 0.5 ? 'red' as const
    : totals.spend / totals.sales < 0.25 ? 'green' as const
    : 'default' as const
    : 'default' as const

  const dayOptions = [7, 14, 30, 60]

  return (
    <div className="space-y-7">

      {/* ── Header ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Overview</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {isCustomRange
                ? `${startStr} — ${endStr}`
                : `Last ${days} days`}
            </p>
          </div>
          {profiles && profiles.length > 0 && (
            <ProfileSelector profiles={profiles} currentProfileId={profileId} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quick day buttons */}
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

          {/* Custom date range */}
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
        Spend includes SP + SB. Sales &amp; orders reflect SP only — Amazon&apos;s SB API does not expose sales attribution in v3 reports.
      </p>

      {/* ── Secondary row: Alerts + Sync ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <AlertsPanel alerts={alertsRes.data ?? []} />
        </div>
        <SyncStatus sync={syncForDisplay} profileId={profileId} />
      </div>

      {/* ── Quick links ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { href: `/dashboard/campaigns?profile_id=${profileId}&days=${days}`,    title: 'Campaign Table',      desc: 'Full metrics for every campaign',         icon: '◈' },
          { href: `/dashboard/search-terms?profile_id=${profileId}&mode=wasted`,  title: 'Wasted Spend',         desc: 'Search terms burning budget with no sales', icon: '💸' },
          { href: `/dashboard/search-terms?profile_id=${profileId}&mode=converters`, title: 'Harvest to Exact', desc: 'Converting terms ready to promote',         icon: '🌟' },
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
