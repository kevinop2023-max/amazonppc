interface Alert {
  id:           number
  alert_type:   string
  severity:     string
  entity_name:  string
  message:      string
  triggered_at: string
}

export default function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const cfg = {
    high:   { bar: 'bg-red-500',    bg: 'bg-red-50',    border: 'border-red-100',   text: 'text-red-700',   badge: 'bg-red-100 text-red-600',    dot: '●' },
    medium: { bar: 'bg-amber-400',  bg: 'bg-amber-50',  border: 'border-amber-100', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-600', dot: '●' },
    low:    { bar: 'bg-blue-400',   bg: 'bg-blue-50',   border: 'border-blue-100',  text: 'text-blue-700',  badge: 'bg-blue-100 text-blue-600',   dot: '●' },
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Active Alerts</h3>
        {alerts.length > 0 && (
          <span className="text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">
            {alerts.length}
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">All clear</p>
          <p className="text-xs text-gray-400 mt-1">No active alerts to action</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => {
            const s = cfg[alert.severity as keyof typeof cfg] ?? cfg.low
            return (
              <div key={alert.id} className={`flex items-start gap-3 p-3.5 rounded-xl border ${s.bg} ${s.border}`}>
                <div className={`w-1 self-stretch rounded-full shrink-0 ${s.bar}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className={`text-xs font-semibold ${s.text} truncate`}>{alert.entity_name}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0 ${s.badge}`}>
                      {alert.alert_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className={`text-xs ${s.text} opacity-80`}>{alert.message}</p>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 mt-0.5">
                  {new Date(alert.triggered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
