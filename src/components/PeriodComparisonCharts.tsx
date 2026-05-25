'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface PeriodData {
  spend: number   // cents
  sales: number   // cents
  orders: number
  spSales: number // cents
  sbSales: number // cents
  spSpend: number // cents
  sbSpend: number // cents
}

interface Props {
  labelA: string
  labelB: string
  A: PeriodData
  B: PeriodData
}

const COLOR_A = '#3b82f6'  // blue   — Previous (A)
const COLOR_B = '#7c3aed'  // violet — Current (B)
const AXIS    = { fontSize: 11, fill: '#9ca3af' }
const GRID    = { strokeDasharray: '3 3', stroke: '#f3f4f6', vertical: false } as const
const RADII   = [4, 4, 0, 0] as [number, number, number, number]

function fmtDollar(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`
  return `$${v.toFixed(0)}`
}

function DollarTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-700">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.fill }}>
          {p.name}: ${Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      ))}
    </div>
  )
}

function OrdersTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-700">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.fill }}>{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

function AcosTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-700">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.fill }}>{p.name}: {Number(p.value).toFixed(1)}%</p>
      ))}
    </div>
  )
}

export default function PeriodComparisonCharts({ labelA, labelB, A, B }: Props) {
  const spendSalesData = [
    { name: 'Spend',    a: +(A.spend   / 100).toFixed(2), b: +(B.spend   / 100).toFixed(2) },
    { name: 'Sales',    a: +(A.sales   / 100).toFixed(2), b: +(B.sales   / 100).toFixed(2) },
    { name: 'SP Sales', a: +(A.spSales / 100).toFixed(2), b: +(B.spSales / 100).toFixed(2) },
    { name: 'SB Sales', a: +(A.sbSales / 100).toFixed(2), b: +(B.sbSales / 100).toFixed(2) },
  ]

  const ordersData = [
    { name: 'Orders', a: A.orders, b: B.orders },
  ]

  const acosData = [
    { name: 'Overall', a: A.sales > 0 ? +(A.spend / A.sales * 100).toFixed(1) : 0, b: B.sales > 0 ? +(B.spend / B.sales * 100).toFixed(1) : 0 },
    { name: 'SP',      a: A.spSales > 0 ? +(A.spSpend / A.spSales * 100).toFixed(1) : 0, b: B.spSales > 0 ? +(B.spSpend / B.spSales * 100).toFixed(1) : 0 },
    { name: 'SB',      a: A.sbSales > 0 ? +(A.sbSpend / A.sbSales * 100).toFixed(1) : 0, b: B.sbSales > 0 ? +(B.sbSpend / B.sbSales * 100).toFixed(1) : 0 },
  ]

  const sharedLegend = {
    formatter: (key: string) => key === 'a' ? `Previous (A) · ${labelA}` : `Current (B) · ${labelB}`,
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: { fontSize: 11, paddingTop: 6 },
  }

  return (
    <div className="grid grid-cols-2 gap-5">

      {/* ── Left: Spend & Sales + Orders ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-semibold text-gray-900 mb-4">
          Spend &amp; Sales: Previous (A) vs Current (B)
        </p>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={spendSalesData} barCategoryGap="35%" barGap={3} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtDollar} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<DollarTip />} />
            <Legend {...sharedLegend} />
            <Bar dataKey="a" name="a" fill={COLOR_A} radius={RADII} />
            <Bar dataKey="b" name="b" fill={COLOR_B} radius={RADII} />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 pt-4 border-t border-gray-50">
          <p className="text-xs font-semibold text-gray-500 mb-2">Orders</p>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={ordersData} barCategoryGap="60%" barGap={4} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
              <Tooltip content={<OrdersTip />} />
              <Bar dataKey="a" name="a" fill={COLOR_A} radius={RADII} />
              <Bar dataKey="b" name="b" fill={COLOR_B} radius={RADII} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Right: ACoS ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-semibold text-gray-900 mb-4">
          ACoS Comparison (%) <span className="font-normal text-gray-400">— lower is better</span>
        </p>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={acosData} barCategoryGap="35%" barGap={3} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `${v}%`} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<AcosTip />} />
            <Legend
              formatter={(key) => key === 'a' ? 'Previous (A)' : 'Current (B)'}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
            />
            <Bar dataKey="a" name="a" fill={COLOR_A} radius={RADII} />
            <Bar dataKey="b" name="b" fill={COLOR_B} radius={RADII} />
          </BarChart>
        </ResponsiveContainer>
      </div>

    </div>
  )
}
