'use client'

import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import type { DayData } from './PerformanceChart'

const METRICS = [
  { key: 'clicks', label: 'Clicks',     aColor: '#93c5fd', bColor: '#2563eb', axis: 'left'  },
  { key: 'spend',  label: 'Total Cost', aColor: '#f9a8d4', bColor: '#db2777', axis: 'right' },
  { key: 'orders', label: 'Orders',     aColor: '#6ee7b7', bColor: '#059669', axis: 'left'  },
  { key: 'sales',  label: 'Sales',      aColor: '#fcd34d', bColor: '#d97706', axis: 'right' },
] as const

type Props = {
  dataA: DayData[]
  dataB: DayData[]
  labelA: string
  labelB: string
}

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CustomTooltip({ active, payload, rows }: any) {
  if (!active || !payload?.length) return null
  const row = rows[payload[0]?.payload?.i ?? 0]
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs space-y-1 min-w-[200px]">
      {(row?.bDate || row?.aDate) && (
        <div className="pb-1.5 mb-0.5 border-b border-gray-50 space-x-2">
          {row.bDate && <span className="text-gray-700 font-medium">B: {fmtDate(row.bDate)}</span>}
          {row.aDate && <span className="text-gray-400">A: {fmtDate(row.aDate)}</span>}
        </div>
      )}
      {payload.map((p: any) => {
        const isDollar = (p.name as string).includes('Cost') || (p.name as string).includes('Sales')
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

export default function CombinedPerformanceChart({ dataA, dataB, labelA, labelB }: Props) {
  const [active, setActive] = useState<Record<string, boolean>>({
    clicks: true, spend: true, orders: true, sales: true,
  })

  const rows = useMemo(() => {
    const len = Math.max(dataA.length, dataB.length)
    return Array.from({ length: len }, (_, i) => {
      const a = dataA[i], b = dataB[i]
      return {
        i,
        aDate:   a?.date,
        bDate:   b?.date,
        aClicks: a?.clicks  ?? null,
        bClicks: b?.clicks  ?? null,
        aOrders: a?.orders  ?? null,
        bOrders: b?.orders  ?? null,
        aSpend:  a != null ? a.spendCents / 100 : null,
        bSpend:  b != null ? b.spendCents / 100 : null,
        aSales:  a != null ? a.salesCents / 100 : null,
        bSales:  b != null ? b.salesCents / 100 : null,
      }
    })
  }, [dataA, dataB])

  const totA = useMemo(() => ({
    clicks:     dataA.reduce((s, d) => s + d.clicks, 0),
    spendCents: dataA.reduce((s, d) => s + d.spendCents, 0),
    orders:     dataA.reduce((s, d) => s + d.orders, 0),
    salesCents: dataA.reduce((s, d) => s + d.salesCents, 0),
  }), [dataA])

  const totB = useMemo(() => ({
    clicks:     dataB.reduce((s, d) => s + d.clicks, 0),
    spendCents: dataB.reduce((s, d) => s + d.spendCents, 0),
    orders:     dataB.reduce((s, d) => s + d.orders, 0),
    salesCents: dataB.reduce((s, d) => s + d.salesCents, 0),
  }), [dataB])

  function toggle(k: string) { setActive(p => ({ ...p, [k]: !p[k] })) }

  const hasLeft  = active.clicks || active.orders
  const hasRight = active.spend  || active.sales

  const pills = [
    { key: 'clicks', label: 'Clicks',     aVal: totA.clicks.toLocaleString(),           bVal: totB.clicks.toLocaleString() },
    { key: 'spend',  label: 'Total Cost', aVal: `$${(totA.spendCents/100).toFixed(2)}`, bVal: `$${(totB.spendCents/100).toFixed(2)}` },
    { key: 'orders', label: 'Orders',     aVal: totA.orders.toLocaleString(),            bVal: totB.orders.toLocaleString() },
    { key: 'sales',  label: 'Sales',      aVal: `$${(totA.salesCents/100).toFixed(2)}`, bVal: `$${(totB.salesCents/100).toFixed(2)}` },
  ]

  if (!dataA.length && !dataB.length) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      {/* Metric pills with A (top) + B (bottom) + legend */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-6">
          {pills.map(m => {
            const meta = METRICS.find(x => x.key === m.key)!
            const isOn = active[m.key]
            return (
              <button key={m.key} onClick={() => toggle(m.key)} className="flex items-center gap-2 text-left">
                <span
                  className="w-3 h-3 rounded-sm shrink-0 transition-all duration-150"
                  style={{ background: isOn ? meta.bColor : '#d1d5db' }}
                />
                <div>
                  <div className={`text-[10px] font-medium leading-none mb-1 transition-colors ${isOn ? 'text-gray-400' : 'text-gray-300'}`}>
                    {m.label}
                  </div>
                  {/* A value — top line */}
                  <div className={`text-xs tabular-nums leading-none mb-0.5 transition-colors ${isOn ? 'text-gray-500' : 'text-gray-300'}`}>
                    {m.aVal}
                  </div>
                  {/* B value — bottom line, bolder */}
                  <div className={`text-sm font-bold tabular-nums leading-none transition-colors ${isOn ? 'text-gray-900' : 'text-gray-300'}`}>
                    {m.bVal}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* A / B period legend */}
        <div className="flex items-center gap-4 text-[11px] text-gray-400 pt-1">
          <span className="flex items-center gap-1.5">
            <svg width="20" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="4 2"/>
            </svg>
            A: {labelA}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="20" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#374151" strokeWidth="2"/>
            </svg>
            B: {labelB}
          </span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={rows} margin={{ top: 4, right: hasRight ? 52 : 8, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="i"
            tickFormatter={v => { const r = rows[v]; return r?.bDate ? fmtDate(r.bDate) : '' }}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false} axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="left" orientation="left"
            tick={hasLeft ? { fontSize: 10, fill: '#9ca3af' } : false}
            tickLine={false} axisLine={false}
            width={hasLeft ? 36 : 0}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          />
          <YAxis
            yAxisId="right" orientation="right"
            tick={hasRight ? { fontSize: 10, fill: '#9ca3af' } : false}
            tickLine={false} axisLine={false}
            width={hasRight ? 52 : 0}
            tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`}
          />
          <Tooltip content={(props: any) => <CustomTooltip {...props} rows={rows} />} />

          {active.clicks && <>
            <Line yAxisId="left"  dataKey="aClicks" name="Clicks (A)"     stroke={METRICS[0].aColor} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            <Line yAxisId="left"  dataKey="bClicks" name="Clicks (B)"     stroke={METRICS[0].bColor} strokeWidth={2}   dot={false} connectNulls />
          </>}
          {active.spend && <>
            <Line yAxisId="right" dataKey="aSpend"  name="Total Cost (A)" stroke={METRICS[1].aColor} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            <Line yAxisId="right" dataKey="bSpend"  name="Total Cost (B)" stroke={METRICS[1].bColor} strokeWidth={2}   dot={false} connectNulls />
          </>}
          {active.orders && <>
            <Line yAxisId="left"  dataKey="aOrders" name="Orders (A)"     stroke={METRICS[2].aColor} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            <Line yAxisId="left"  dataKey="bOrders" name="Orders (B)"     stroke={METRICS[2].bColor} strokeWidth={2}   dot={false} connectNulls />
          </>}
          {active.sales && <>
            <Line yAxisId="right" dataKey="aSales"  name="Sales (A)"      stroke={METRICS[3].aColor} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            <Line yAxisId="right" dataKey="bSales"  name="Sales (B)"      stroke={METRICS[3].bColor} strokeWidth={2}   dot={false} connectNulls />
          </>}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
