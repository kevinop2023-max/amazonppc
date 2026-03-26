import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const revalidate = 0

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; severity?: string }
}) {
  const supabase  = await createClient()
  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  const severity  = searchParams.severity

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  let q = supabase
    .from('alerts')
    .select('*')
    .eq('profile_id', profileId)
    .is('dismissed_at', null)
    .order('triggered_at', { ascending: false })
  if (severity) q = q.eq('severity', severity)
  const { data: alerts } = await q

  const sevCfg = {
    high:   { bar: 'bg-red-500',   bg: 'bg-white', border: 'border-red-200',   label: 'bg-red-100 text-red-600',     dot: 'bg-red-500'   },
    medium: { bar: 'bg-amber-400', bg: 'bg-white', border: 'border-amber-200', label: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
    low:    { bar: 'bg-blue-400',  bg: 'bg-white', border: 'border-blue-200',  label: 'bg-blue-50 text-blue-600',    dot: 'bg-blue-400'  },
  }

  const counts = {
    high:   alerts?.filter(a => a.severity === 'high').length   ?? 0,
    medium: alerts?.filter(a => a.severity === 'medium').length ?? 0,
    low:    alerts?.filter(a => a.severity === 'low').length    ?? 0,
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-400 mt-0.5">{alerts?.length ?? 0} active</p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
          {[['', 'All', null], ['high', 'High', counts.high], ['medium', 'Medium', counts.medium], ['low', 'Low', counts.low]].map(([s, label, count]) => (
            <Link key={String(s)} href={`/dashboard/alerts?profile_id=${profileId}${s ? `&severity=${s}` : ''}`}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                (severity ?? '') === s ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {label}
              {count !== null && Number(count) > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  (severity ?? '') === s ? 'bg-white/20 text-white' :
                  s === 'high' ? 'bg-red-100 text-red-600' : s === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                }`}>{count}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {([['high', 'High', '🔴'], ['medium', 'Medium', '🟡'], ['low', 'Low', '🔵']] as const).map(([s, label, icon]) => (
          <div key={s} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm text-center">
            <div className="text-2xl mb-2">{icon}</div>
            <p className="text-2xl font-bold text-gray-900">{counts[s]}</p>
            <p className="text-xs text-gray-400 mt-1">{label} priority</p>
          </div>
        ))}
      </div>

      {/* Alert list */}
      {!alerts?.length ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="font-semibold text-gray-900">No active alerts</p>
          <p className="text-sm text-gray-400 mt-1">All campaigns are within normal parameters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => {
            const s = sevCfg[alert.severity as keyof typeof sevCfg] ?? sevCfg.low
            return (
              <div key={alert.id} className={`flex items-stretch gap-0 ${s.bg} rounded-2xl border ${s.border} shadow-sm overflow-hidden`}>
                <div className={`w-1 shrink-0 ${s.bar}`} />
                <div className="flex items-start justify-between gap-4 p-5 flex-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="font-semibold text-gray-900 text-sm">{alert.entity_name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${s.label}`}>
                        {alert.alert_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{alert.message}</p>
                    {alert.suggested_action && (
                      <p className="text-xs text-gray-400 mt-2 flex items-start gap-1.5">
                        <span className="shrink-0">💡</span>
                        {alert.suggested_action}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-xs text-gray-400">
                      {new Date(alert.triggered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <button className="text-[11px] font-medium text-gray-400 hover:text-gray-600 border border-gray-200 px-2.5 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
