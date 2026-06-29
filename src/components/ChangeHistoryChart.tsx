'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'

export type ChangePoint = {
  ts: string                 // ISO timestamp
  old_value: number | null
  new_value: number | null
}

type Props = {
  events: ChangePoint[]      // change events for ONE entity+field
  kind: 'cents' | 'percent'
  color?: string
  height?: number
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtValue(v: number | null, kind: 'cents' | 'percent') {
  if (v == null) return '—'
  return kind === 'cents' ? `$${(v / 100).toFixed(2)}` : `${v > 0 ? '+' : ''}${v}%`
}

function Tip({ active, payload, kind }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-2.5 text-xs">
      <div className="text-gray-400 mb-0.5">{fmtDate(p.ts)}</div>
      <div className="font-semibold text-gray-900 tabular-nums">{fmtValue(p.v, kind)}</div>
    </div>
  )
}

export default function ChangeHistoryChart({ events, kind, color = '#2563eb', height = 140 }: Props) {
  const pts = useMemo(() => {
    const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts))
    if (!sorted.length) return []
    // Leading point = value BEFORE the first change, dated one day earlier so the step is visible.
    const first = new Date(sorted[0].ts)
    first.setDate(first.getDate() - 1)
    const out: { ts: string; v: number | null }[] = [{ ts: first.toISOString(), v: sorted[0].old_value }]
    for (const e of sorted) out.push({ ts: e.ts, v: e.new_value })
    return out
  }, [events])

  if (pts.length < 2) return null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={fmtDate}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false} axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false} axisLine={false}
          width={kind === 'cents' ? 44 : 36}
          tickFormatter={(v: number) => kind === 'cents' ? `$${(v / 100).toFixed(2)}` : `${v}%`}
          domain={['auto', 'auto']}
        />
        <Tooltip content={(props: any) => <Tip {...props} kind={kind} />} />
        <Line
          type="stepAfter" dataKey="v"
          stroke={color} strokeWidth={2}
          dot={{ r: 3, fill: color }} activeDot={{ r: 5 }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
