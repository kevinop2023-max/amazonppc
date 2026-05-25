import React from 'react'

interface Period {
  spend:  number  // cents
  sales:  number  // cents
  orders: number
}

interface SpbPeriod {
  spend: number   // cents
  sales: number   // cents
}

interface Props {
  fullLabel: string   // "Apr 26 – May 25" (complete selected range)
  labelA:    string   // "Apr 26 – May 10" (first half)
  labelB:    string   // "May 11 – May 25" (second half)
  full: Period
  sp:   SpbPeriod
  sb:   SpbPeriod
  A:    Period
  spA:  SpbPeriod
  sbA:  SpbPeriod
  B:    Period
  spB:  SpbPeriod
  sbB:  SpbPeriod
}

function fmt$(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function acos(spend: number, sales: number): number | null {
  return sales > 0 ? spend / sales * 100 : null
}

function roas(spend: number, sales: number): number | null {
  return spend > 0 ? sales / spend : null
}

function pctChange(from: number, to: number): number | null {
  return from === 0 ? null : (to - from) / from * 100
}

type Trend = 'improved' | 'worsened' | 'declined' | 'stable' | 'neutral'

function acostTrend(ppChange: number | null): Trend {
  if (ppChange === null) return 'stable'
  if (Math.abs(ppChange) < 1.5) return 'stable'
  return ppChange < 0 ? 'improved' : 'worsened'
}

function volumeTrend(pct: number | null): Trend {
  if (pct === null) return 'stable'
  if (Math.abs(pct) < 3) return 'stable'
  return pct > 0 ? 'improved' : 'declined'
}

interface RowConfig {
  label:       string
  fullStr:     string
  aStr:        string
  bStr:        string
  change:      { value: string; type: 'pp' | 'pct' | 'neutral' | 'hidden'; improved: boolean | null }
  trend:       Trend
}

function TrendBadge({ trend }: { trend: Trend }) {
  if (trend === 'improved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
        ✓ Improved
      </span>
    )
  }
  if (trend === 'worsened') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md border border-orange-100">
        ⚠ Worsened
      </span>
    )
  }
  if (trend === 'declined') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md border border-orange-100">
        ⚠ Declined
      </span>
    )
  }
  if (trend === 'neutral') return null
  return <span className="text-[11px] text-gray-400">Stable</span>
}

function ChangeBadge({ change }: { change: RowConfig['change'] }) {
  if (change.type === 'hidden') return <span className="text-xs text-gray-300">—</span>

  const { value, improved } = change
  if (improved === null) {
    // neutral (Spend) — just gray text
    return <span className="text-xs text-gray-400 tabular-nums">{value}</span>
  }
  if (improved === true) {
    return (
      <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100 tabular-nums">
        {value}
      </span>
    )
  }
  // improved === false → bad
  return (
    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100 tabular-nums">
      {value}
    </span>
  )
}

export default function KpiComparisonTable({
  fullLabel, labelA, labelB,
  full, sp, sb,
  A, spA, sbA,
  B, spB, sbB,
}: Props) {

  const acosAll  = acos(full.spend, full.sales)
  const acosA    = acos(A.spend, A.sales)
  const acosB    = acos(B.spend, B.sales)
  const acosPP   = acosA !== null && acosB !== null ? acosB - acosA : null

  const spAcosAll = acos(sp.spend, sp.sales)
  const spAcosA   = acos(spA.spend, spA.sales)
  const spAcosB   = acos(spB.spend, spB.sales)
  const spAcosPP  = spAcosA !== null && spAcosB !== null ? spAcosB - spAcosA : null

  const sbAcosAll = acos(sb.spend, sb.sales)
  const sbAcosA   = acos(sbA.spend, sbA.sales)
  const sbAcosB   = acos(sbB.spend, sbB.sales)
  const sbAcosPP  = sbAcosA !== null && sbAcosB !== null ? sbAcosB - sbAcosA : null

  const roasAll = roas(full.spend, full.sales)
  const roasA   = roas(A.spend, A.sales)
  const roasB   = roas(B.spend, B.sales)
  const roasPct = roasA !== null && roasB !== null ? pctChange(roasA, roasB) : null

  const spendPct  = pctChange(A.spend,  B.spend)
  const salesPct  = pctChange(A.sales,  B.sales)
  const ordersPct = pctChange(A.orders, B.orders)
  const spSalesPct = pctChange(spA.sales, spB.sales)
  const sbSalesPct = pctChange(sbA.sales, sbB.sales)

  function ppChange(pp: number | null, lowIsGood = true): RowConfig['change'] {
    if (pp === null) return { value: '—', type: 'hidden', improved: null }
    const abs = Math.abs(pp)
    if (abs < 0.1) return { value: '0.0pp', type: 'pp', improved: null }
    const label = `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp`
    const isGood = lowIsGood ? pp < 0 : pp > 0
    return { value: label, type: 'pp', improved: abs >= 1 ? isGood : null }
  }

  function pctChg(p: number | null, highIsGood: boolean, threshold = 1): RowConfig['change'] {
    if (p === null) return { value: '—', type: 'hidden', improved: null }
    if (Math.abs(p) < 0.1) return { value: '0.0%', type: 'pct', improved: null }
    const label = `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
    const isGood = highIsGood ? p > 0 : p < 0
    return { value: label, type: 'pct', improved: Math.abs(p) >= threshold ? isGood : null }
  }

  function neutralPct(p: number | null): RowConfig['change'] {
    if (p === null) return { value: '—', type: 'hidden', improved: null }
    return { value: `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`, type: 'neutral', improved: null }
  }

  const rows: RowConfig[] = [
    {
      label:   'Overall ACoS',
      fullStr: acosAll !== null ? acosAll.toFixed(1) + '%' : '—',
      aStr:    acosA   !== null ? acosA.toFixed(1)   + '%' : '—',
      bStr:    acosB   !== null ? acosB.toFixed(1)   + '%' : '—',
      change:  ppChange(acosPP, true),
      trend:   acostTrend(acosPP),
    },
    {
      label:   'SP ACoS',
      fullStr: spAcosAll !== null ? spAcosAll.toFixed(1) + '%' : '—',
      aStr:    spAcosA   !== null ? spAcosA.toFixed(1)   + '%' : '—',
      bStr:    spAcosB   !== null ? spAcosB.toFixed(1)   + '%' : '—',
      change:  ppChange(spAcosPP, true),
      trend:   acostTrend(spAcosPP),
    },
    {
      label:   'SB ACoS',
      fullStr: sbAcosAll !== null ? sbAcosAll.toFixed(1) + '%' : '—',
      aStr:    sbAcosA   !== null ? sbAcosA.toFixed(1)   + '%' : '—',
      bStr:    sbAcosB   !== null ? sbAcosB.toFixed(1)   + '%' : '—',
      change:  ppChange(sbAcosPP, true),
      trend:   acostTrend(sbAcosPP),
    },
    {
      label:   'Overall ROAS',
      fullStr: roasAll !== null ? roasAll.toFixed(2) + 'x' : '—',
      aStr:    roasA   !== null ? roasA.toFixed(2)   + 'x' : '—',
      bStr:    roasB   !== null ? roasB.toFixed(2)   + 'x' : '—',
      change:  pctChg(roasPct, true),
      trend:   volumeTrend(roasPct),
    },
    {
      label:   'Total Spend',
      fullStr: fmt$(full.spend),
      aStr:    fmt$(A.spend),
      bStr:    fmt$(B.spend),
      change:  neutralPct(spendPct),
      trend:   'neutral',
    },
    {
      label:   'Total Sales',
      fullStr: fmt$(full.sales),
      aStr:    fmt$(A.sales),
      bStr:    fmt$(B.sales),
      change:  pctChg(salesPct, true, 3),
      trend:   volumeTrend(salesPct),
    },
    {
      label:   'Total Orders',
      fullStr: full.orders.toLocaleString(),
      aStr:    A.orders.toLocaleString(),
      bStr:    B.orders.toLocaleString(),
      change:  pctChg(ordersPct, true, 5),
      trend:   volumeTrend(ordersPct),
    },
    {
      label:   'SP Sales',
      fullStr: fmt$(sp.sales),
      aStr:    fmt$(spA.sales),
      bStr:    fmt$(spB.sales),
      change:  pctChg(spSalesPct, true, 3),
      trend:   volumeTrend(spSalesPct),
    },
    {
      label:   'SB Sales',
      fullStr: fmt$(sb.sales),
      aStr:    fmt$(sbA.sales),
      bStr:    fmt$(sbB.sales),
      change:  pctChg(sbSalesPct, true, 3),
      trend:   volumeTrend(sbSalesPct),
    },
  ]

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-900">Overall KPI Comparison</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Previous (A): {labelA} &nbsp;·&nbsp; Current (B): {labelB}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/50 border-b border-gray-50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Metric</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{fullLabel}</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Previous (A)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Current (B)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Change</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/30 transition-colors">
                <td className="px-5 py-3 text-xs font-medium text-gray-700 whitespace-nowrap">{row.label}</td>
                <td className="px-4 py-3 text-right text-xs text-gray-400 tabular-nums">{row.fullStr}</td>
                <td className="px-4 py-3 text-right text-xs text-gray-500 tabular-nums">{row.aStr}</td>
                <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900 tabular-nums">{row.bStr}</td>
                <td className="px-4 py-3 text-right">
                  <ChangeBadge change={row.change} />
                </td>
                <td className="px-5 py-3 text-right">
                  <TrendBadge trend={row.trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
