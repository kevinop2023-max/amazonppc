'use client'

import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'

export type DailyPoint = { date: string; spendCents: number; salesCents: number; clicks: number; orders: number }
export type ChangeMarker = { date: string; labels: string[] }

const METRICS = [
  { key: 'clicks', label: 'Clicks', color: '#2563eb', axis: 'left'  },
  { key: 'orders', label: 'Orders', color: '#059669', axis: 'left'  },
  { key: 'spend',  label: 'Spend',  color: '#db2777', axis: 'right' },
  { key: 'sales',  label: 'Sales',  color: '#d97706', axis: 'right' },
] as const

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Tip({ active, payload, label, markerMap }: any) {
  if (!active || !payload?.length) return null
  const changes: string[] = markerMap[label] ?? []
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs space-y-1 min-w-[180px]">
      <div className="text-gray-700 font-medium pb-1 border-b border-gray-50">{fmtDate(label)}</div>
      {payload.map((p: any) => {
        const isDollar = p.name === 'Spend' || p.name === 'Sales'
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} /><span className="text-gray-500">{p.name}</span></span>
            <span className="font-semibold text-gray-900 tabular-nums">{isDollar ? `$${Number(p.value).toFixed(2)}` : Number(p.value).toLocaleString()}</span>
          </div>
        )
      })}
      {changes.length > 0 && (
        <div className="pt-1.5 mt-1 border-t border-gray-50 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-orange-500 font-semibold">Changes</div>
          {changes.map((c, i) => <div key={i} className="text-gray-600">{c}</div>)}
        </div>
      )}
    </div>
  )
}

export default function CampaignPerformanceChart({ daily, markers }: { daily: DailyPoint[]; markers: ChangeMarker[] }) {
  const [active, setActive] = useState<Record<string, boolean>>({ clicks: false, orders: false, spend: true, sales: true })

  const rows = useMemo(() => daily.map(d => ({
    date: d.date, clicks: d.clicks, orders: d.orders,
    spend: d.spendCents / 100, sales: d.salesCents / 100,
  })), [daily])

  const markerMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const k of markers) m[k.date] = k.labels
    return m
  }, [markers])

  const hasLeft  = active.clicks || active.orders
  const hasRight = active.spend  || active.sales

  if (!rows.length) return <div className="text-sm text-gray-400 py-8 text-center">No performance data for this period.</div>

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-3">
        {METRICS.map(m => (
          <button key={m.key} onClick={() => setActive(p => ({ ...p, [m.key]: !p[m.key] }))} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: active[m.key] ? m.color : '#d1d5db' }} />
            <span className={`text-xs font-medium ${active[m.key] ? 'text-gray-700' : 'text-gray-300'}`}>{m.label}</span>
          </button>
        ))}
        {markers.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400 ml-auto">
            <svg width="14" height="12"><line x1="7" y1="0" x2="7" y2="12" stroke="#f97316" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
            change ({markers.length})
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 8, right: hasRight ? 52 : 8, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
          <YAxis yAxisId="left" orientation="left" tick={hasLeft ? { fontSize: 10, fill: '#9ca3af' } : false} tickLine={false} axisLine={false} width={hasLeft ? 36 : 0} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
          <YAxis yAxisId="right" orientation="right" tick={hasRight ? { fontSize: 10, fill: '#9ca3af' } : false} tickLine={false} axisLine={false} width={hasRight ? 52 : 0} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`} />
          <Tooltip content={(props: any) => <Tip {...props} markerMap={markerMap} />} />
          {markers.map((mk, i) => (
            <ReferenceLine key={i} x={mk.date} yAxisId="right" stroke="#f97316" strokeWidth={1} strokeDasharray="3 2" />
          ))}
          {active.clicks && <Line yAxisId="left"  dataKey="clicks" name="Clicks" stroke={METRICS[0].color} strokeWidth={2} dot={false} connectNulls />}
          {active.orders && <Line yAxisId="left"  dataKey="orders" name="Orders" stroke={METRICS[1].color} strokeWidth={2} dot={false} connectNulls />}
          {active.spend  && <Line yAxisId="right" dataKey="spend"  name="Spend"  stroke={METRICS[2].color} strokeWidth={2} dot={false} connectNulls />}
          {active.sales  && <Line yAxisId="right" dataKey="sales"  name="Sales"  stroke={METRICS[3].color} strokeWidth={2} dot={false} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
