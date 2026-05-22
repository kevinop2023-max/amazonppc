import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 0

const statusConfig = {
  success:         { badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'Synced'    },
  partial:         { badge: 'bg-amber-50 text-amber-700 border-amber-100',       label: 'Partial'   },
  failed:          { badge: 'bg-red-50 text-red-600 border-red-100',             label: 'Failed'    },
  reports_pending: { badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…'  },
  running:         { badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…'  },
  downloading:     { badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…'  },
  cancelled:       { badge: 'bg-gray-50 text-gray-500 border-gray-200',          label: 'Cancelled' },
}

export default async function SyncHistoryPage({
  searchParams,
}: {
  searchParams: { profile_id?: string }
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

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  const { data: logs } = await supabase
    .from('sync_logs')
    .select('id, status, triggered_by, started_at, completed_at, records_upserted, date_range_start, date_range_end, metadata')
    .eq('profile_id', profileId)
    .order('started_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sync History</h1>
          <p className="text-sm text-gray-400 mt-0.5">Last 50 sync sessions</p>
        </div>
        <Link
          href={`/dashboard?profile_id=${profileId}`}
          className="text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Overview
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Date Range</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Trigger</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">SP</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">SB</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">SD</th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody>
              {!logs?.length ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-sm text-gray-400">
                    No sync history found.
                  </td>
                </tr>
              ) : logs.map(log => {
                const cfg = statusConfig[log.status as keyof typeof statusConfig] ?? statusConfig.partial
                const t = log.completed_at ?? log.started_at
                const byType = (log.metadata as any)?.records_by_type as { sp?: number; sb?: number; sd?: number } | undefined
                return (
                  <tr key={log.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-xs text-gray-700 tabular-nums whitespace-nowrap" suppressHydrationWarning>
                      {new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                      {log.date_range_start && log.date_range_end
                        ? `${log.date_range_start} – ${log.date_range_end}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400 capitalize">
                      {log.triggered_by ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right text-xs text-gray-600 tabular-nums">
                      {byType?.sp != null ? byType.sp.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right text-xs text-gray-600 tabular-nums">
                      {byType?.sb != null ? byType.sb.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right text-xs text-gray-600 tabular-nums">
                      {byType?.sd != null ? byType.sd.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-semibold text-gray-900 tabular-nums">
                      {log.records_upserted != null ? log.records_upserted.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        SP/SB/SD breakdown available for syncs after this feature was added. Older rows show — in those columns.
      </p>
    </div>
  )
}