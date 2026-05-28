'use client'

import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'

export type DayData = {
  date: string
  spendCents: number
  salesCents: number
  orders: number
  clicks: number
}

type Props = {
  data: DayData[]
  title: string
}

const METRICS = [
  { key: 'clicks', label: 'Clicks',     color: '#2563eb', axis: 'left'  },
  { key: 'spend',  label: 'Total Cost', color: '#db2777', axis: 'right' },
  { key: 'orders', label: 'Orders',     color: '#059669', axis: 'left'  },
  { key: 'sales',  label: 'Sales',      color: '#d97706', axis: 'right' },
] as const

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CustomTooltip({ active, payload, rows }: any) {
  if (!active || !payload?.length) return null
  const row = rows[payload[0]?.payload?.i ?? 0]
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs space-y-1 min-w-[180px]">
      {row?.date && (
        <p className="font-semibold text-gray-600 pb-1 border-b border-gray-50">{fmtDate(row.date)}</p>
      )}
      {payload.map((p: any) => {
        const isDollar = (p.name as string).startsWith('Cost') || (p.name as string).startsWith('Sales')
        const val = p.value == null ? '—'
          : isDollar ? `$${Number(p.value).toFixed(2)}`
          : Number(p.value).toLocaleString()
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-gray-500">{p.name}</span>
            </span>
            <span className="font-semibold text-gray-900 tabular-nums">{val}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function PerformanceChart({ data, title }: Props) {
  const [active, setActive] = useState<Record<string, boolean>>({
    clicks: true, spend: true, orders: true, sales: true,
  })

  const rows = useMemo(() =>
    data.map((d, i) => ({
      i,
      date:   d.date,
      clicks: d.clicks,
      orders: d.orders,
      spend:  d.spendCents / 100,
      sales:  d.salesCents / 100,
    })),
  [data])

  const tots = useMemo(() => ({
    clicks:     data.reduce((s, d) => s + d.clicks, 0),
    spendCents: data.reduce((s, d) => s + d.spendCents, 0),
    orders:     data.reduce((s, d) => s + d.orders, 0),
    salesCents: data.reduce((s, d) => s + d.salesCents, 0),
  }), [data])

  function toggle(k: string) { setActive(p => ({ ...p, [k]: !p[k] })) }

  const hasLeft  = active.clicks || active.orders
  const hasRight = active.spend  || active.sales

  const pills = [
    { key: 'clicks', label: 'Clicks',     val: tots.clicks.toLocaleString() },
    { key: 'spend',  label: 'Total Cost', val: `$${(tots.spendCents / 100).toFixed(2)}` },
    { key: 'orders', label: 'Orders',     val: tots.orders.toLocaleString() },
    { key: 'sales',  label: 'Sales',      val: `$${(tots.salesCents / 100).toFixed(2)}` },
  ]

  if (!data.length) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      {/* Period label */}
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</p>

      {/* Metric toggle pills */}
      <div className="flex flex-wrap items-center gap-4 mb-3">
        {pills.map(m => {
          const meta = METRICS.find(x => x.key === m.key)!
          const isOn = active[m.key]
          return (
            <button key={m.key} onClick={() => toggle(m.key)} className="flex items-center gap-1.5 text-left">
              <span
                className="w-3 h-3 rounded-sm shrink-0 transition-all duration-150"
                style={{ background: isOn ? meta.color : '#d1d5db' }}
              />
              <div>
                <div className={`text-[10px] font-medium leading-none mb-0.5 transition-colors ${isOn ? 'text-gray-400' : 'text-gray-300'}`}>
                  {m.label}
                </div>
                <div className={`text-xs font-bold tabular-nums leading-none transition-colors ${isOn ? 'text-gray-900' : 'text-gray-300'}`}>
                  {m.val}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={rows} margin={{ top: 4, right: hasRight ? 48 : 6, bottom: 0, left: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="i"
            tickFormatter={v => { const r = rows[v]; return r?.date ? fmtDate(r.date) : '' }}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false} axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="left" orientation="left"
            tick={hasLeft ? { fontSize: 10, fill: '#9ca3af' } : false}
            tickLine={false} axisLine={false}
            width={hasLeft ? 34 : 0}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          />
          <YAxis
            yAxisId="right" orientation="right"
            tick={hasRight ? { fontSize: 10, fill: '#9ca3af' } : false}
            tickLine={false} axisLine={false}
            width={hasRight ? 48 : 0}
            tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`}
          />
          <Tooltip content={(props: any) => <CustomTooltip {...props} rows={rows} />} />

          {active.clicks && <Line yAxisId="left"  dataKey="clicks" name="Clicks"     stroke={METRICS[0].color} strokeWidth={2} dot={false} connectNulls />}
          {active.spend  && <Line yAxisId="right" dataKey="spend"  name="Cost"       stroke={METRICS[1].color} strokeWidth={2} dot={false} connectNulls />}
          {active.orders && <Line yAxisId="left"  dataKey="orders" name="Orders"     stroke={METRICS[2].color} strokeWidth={2} dot={false} connectNulls />}
          {active.sales  && <Line yAxisId="right" dataKey="sales"  name="Sales"      stroke={METRICS[3].color} strokeWidth={2} dot={false} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
