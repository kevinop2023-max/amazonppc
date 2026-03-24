interface MetricCardProps {
  label:      string
  value:      string
  sub?:       string
  trend?:     number   // positive = good, negative = bad
  highlight?: 'green' | 'amber' | 'red' | 'default'
}

export default function MetricCard({ label, value, sub, trend, highlight = 'default' }: MetricCardProps) {
  const valueColor =
    highlight === 'green' ? 'text-emerald-600' :
    highlight === 'amber' ? 'text-amber-600'   :
    highlight === 'red'   ? 'text-red-600'     : 'text-gray-900'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
      <p className={`text-2xl font-bold mt-2 tracking-tight ${valueColor}`}>{value}</p>
      {(sub || trend !== undefined) && (
        <div className="flex items-center gap-1.5 mt-1.5">
          {trend !== undefined && (
            <span className={`text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {sub && <span className="text-xs text-gray-400">{sub}</span>}
        </div>
      )}
    </div>
  )
}
