'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import PerformanceChart from './PerformanceChart'
import type { DayData } from './PerformanceChart'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampComp = {
  id: number; name: string; type: 'SP' | 'SB'; state: string; aBudget: number; bBudget: number
  aSpend: number; aSales: number; aOrders: number; aImp: number; aClicks: number
  bSpend: number; bSales: number; bOrders: number; bImp: number; bClicks: number
}

export type TermComp = {
  term: string; campaignId: number; campaignName: string
  aSpend: number; aSales: number; aOrders: number; aClicks: number; aImp: number
  bSpend: number; bSales: number; bOrders: number; bClicks: number; bImp: number
}

export type BidRecord = { date: string; bidCents: number }

export type KwComp = {
  keywordId: number; keywordText: string; matchType: string; adType: string
  campaignId: number; campaignName: string
  bidHistory: BidRecord[]
  aSpend: number; aSales: number; aOrders: number; aClicks: number; aImp: number
  bSpend: number; bSales: number; bOrders: number; bClicks: number; bImp: number
}

interface Props {
  profileId: number
  aStart: string; aEnd: string
  bStart: string; bEnd: string
  camps: CampComp[]
  terms: TermComp[]
  keywords: KwComp[]
  earliestDate: string | null
  chartDataA: DayData[]
  chartDataB: DayData[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientDateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

function quickSplit(totalDays: number) {
  const half = Math.floor(totalDays / 2)
  return {
    aStart: clientDateStr(totalDays),
    aEnd:   clientDateStr(half + 1),
    bStart: clientDateStr(half),
    bEnd:   clientDateStr(1),
  }
}

function allTimeSplit(earliest: string) {
  const start = new Date(earliest + 'T12:00:00Z')
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const mid = new Date((start.getTime() + yesterday.getTime()) / 2)
  const midStr  = mid.toISOString().split('T')[0]
  const dayAfterMid = new Date(mid.getTime() + 86400000).toISOString().split('T')[0]
  return {
    aStart: earliest,
    aEnd:   midStr,
    bStart: dayAfterMid,
    bEnd:   yesterday.toISOString().split('T')[0],
  }
}

function fmtD(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function acosPct(spend: number, sales: number): number | null {
  return sales > 0 ? spend / sales * 100 : null
}

function pctChg(a: number, b: number): number | null {
  return a === 0 ? null : (b - a) / a * 100
}

// ── Primitive components ──────────────────────────────────────────────────────

function TypePill({ type }: { type: string }) {
  const cls = type === 'SP' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${cls}`}>{type}</span>
}

function AcosBadge({ acos }: { acos: number | null }) {
  if (acos === null) return <span className="text-xs text-gray-300">—</span>
  const dot = acos < 25 ? 'bg-emerald-500' : acos < 50 ? 'bg-amber-400' : 'bg-orange-500'
  const txt = acos < 25 ? 'text-emerald-700' : acos < 50 ? 'text-amber-600' : 'text-orange-600'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${txt}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      {acos.toFixed(1)}%
    </span>
  )
}

// Generic delta badge — positive/negative with optional lowerIsBetter logic
function DeltaBadge({
  value, unit = 'pct', lowerIsBetter = false, threshold = 1,
}: {
  value: number | null; unit?: 'pp' | 'pct'; lowerIsBetter?: boolean; threshold?: number
}) {
  if (value === null) return <span className="text-[11px] text-gray-300">N/A</span>
  const abs = Math.abs(value)
  const sign = value >= 0 ? '+' : ''
  const suffix = unit === 'pp' ? 'pp' : '%'
  const str = `${sign}${value.toFixed(1)}${suffix}`

  if (abs < 0.1) return <span className="text-[11px] text-gray-400">—</span>

  const isGood = lowerIsBetter ? value < 0 : value > 0
  const isSignificant = abs >= threshold

  if (!isSignificant) return <span className="text-[11px] text-gray-400">{str}</span>

  const cls = isGood
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-red-50 text-red-600 border-red-100'

  return (
    <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-md border ${cls}`}>
      {str}
    </span>
  )
}

// Spend delta — neutral gray, no good/bad
function SpendDeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-gray-300">N/A</span>
  const abs = Math.abs(value)
  if (abs < 0.1) return <span className="text-[11px] text-gray-400">—</span>
  const sign = value >= 0 ? '+' : ''
  return <span className="text-[11px] text-gray-500">{sign}{value.toFixed(1)}%</span>
}

// Summary card at the top of the page
function SummaryCard({
  label, aStr, bStr, delta, unit, lowerIsBetter,
}: {
  label: string; aStr: string; bStr: string
  delta: number | null; unit: 'pp' | 'pct'; lowerIsBetter?: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <p className="text-sm text-gray-600 font-semibold mb-3">{label}</p>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-sm text-gray-400 tabular-nums">{aStr}</span>
        <span className="text-gray-300">→</span>
        <span className="text-base font-semibold text-gray-900 tabular-nums">{bStr}</span>
      </div>
      <DeltaBadge value={delta} unit={unit} lowerIsBetter={lowerIsBetter} threshold={unit === 'pp' ? 1 : 2} />
    </div>
  )
}

// ── Campaign expanded row ─────────────────────────────────────────────────────

function CampExpanded({ camp, terms }: { camp: CampComp; terms: TermComp[] }) {
  const campTerms = terms.filter(t => t.campaignId === camp.id)

  const aAcos = acosPct(camp.aSpend, camp.aSales)
  const bAcos = acosPct(camp.bSpend, camp.bSales)
  const aRoas = camp.aSpend > 0 ? camp.aSales / camp.aSpend : null
  const bRoas = camp.bSpend > 0 ? camp.bSales / camp.bSpend : null
  const aCpc  = camp.aClicks > 0 ? camp.aSpend / camp.aClicks / 100 : null
  const bCpc  = camp.bClicks > 0 ? camp.bSpend / camp.bClicks / 100 : null
  const aCtr  = camp.aImp > 0 ? camp.aClicks / camp.aImp * 100 : null
  const bCtr  = camp.bImp > 0 ? camp.bClicks / camp.bImp * 100 : null
  const aCvr  = camp.aClicks > 0 ? camp.aOrders / camp.aClicks * 100 : null
  const bCvr  = camp.bClicks > 0 ? camp.bOrders / camp.bClicks * 100 : null

  const harvestTerms = campTerms.filter(t => t.bOrders > 0).sort((a, b) => b.bOrders - a.bOrders).slice(0, 10)
  const wastedAAll = campTerms.filter(t => t.aSpend > 200 && t.aOrders === 0).sort((a, b) => b.aSpend - a.aSpend)
  const wastedBAll = campTerms.filter(t => t.bSpend > 200 && t.bOrders === 0).sort((a, b) => b.bSpend - a.bSpend)
  const wastedA = wastedAAll.slice(0, 8)
  const wastedB = wastedBAll.slice(0, 8)

  const panel = (label: string, metrics: { spend: number; sales: number; orders: number; acos: number | null; roas: number | null; imp: number; clicks: number; cpc: number | null; ctr: number | null; cvr: number | null }) => (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-500 mb-3">{label}</p>
      <div className="grid grid-cols-2 gap-x-6">
        <div className="space-y-1.5">
          {[
            { l: 'Spend',  v: fmtD(metrics.spend) },
            { l: 'Orders', v: metrics.orders.toLocaleString() },
            { l: 'ROAS',   v: metrics.roas   !== null ? metrics.roas.toFixed(2) + 'x' : null },
            { l: 'Clicks', v: metrics.clicks.toLocaleString() },
            { l: 'CTR',    v: metrics.ctr    !== null ? metrics.ctr.toFixed(2) + '%' : null },
          ].map(r => (
            <div key={r.l} className="flex justify-between py-0.5 border-b border-gray-50 last:border-0">
              <span className="text-[11px] text-gray-400">{r.l}</span>
              <span className="text-[11px] font-medium text-gray-900 tabular-nums">{r.v ?? '—'}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {[
            { l: 'Sales',       v: fmtD(metrics.sales) },
            { l: 'ACoS',        v: metrics.acos !== null ? metrics.acos.toFixed(1) + '%' : null },
            { l: 'Impressions', v: metrics.imp.toLocaleString() },
            { l: 'CPC',         v: metrics.cpc  !== null ? '$' + metrics.cpc.toFixed(2) : null },
            { l: 'CVR',         v: metrics.cvr  !== null ? metrics.cvr.toFixed(2) + '%' : null },
          ].map(r => (
            <div key={r.l} className="flex justify-between py-0.5 border-b border-gray-50 last:border-0">
              <span className="text-[11px] text-gray-400">{r.l}</span>
              <span className="text-[11px] font-medium text-gray-900 tabular-nums">{r.v ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <tr>
      <td colSpan={16} className="px-4 py-4 bg-gray-50/40 border-b border-gray-100">

        {/* A vs B metric panels */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {panel('A — Previous', { spend: camp.aSpend, sales: camp.aSales, orders: camp.aOrders, acos: aAcos, roas: aRoas, imp: camp.aImp, clicks: camp.aClicks, cpc: aCpc, ctr: aCtr, cvr: aCvr })}
          {panel('B — Current',  { spend: camp.bSpend, sales: camp.bSales, orders: camp.bOrders, acos: bAcos, roas: bRoas, imp: camp.bImp, clicks: camp.bClicks, cpc: bCpc, ctr: bCtr, cvr: bCvr })}
        </div>

        {/* Harvest terms */}
        {harvestTerms.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <p className="text-xs font-semibold text-gray-700">Harvest Terms Comparison</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Search Term</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-blue-400 uppercase">A Orders</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-blue-400 uppercase">A ACoS</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-purple-400 uppercase">B Orders</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-purple-400 uppercase">B ACoS</th>
                    <th className="text-center px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">Status</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {harvestTerms.map((t, i) => {
                    const tAa = acosPct(t.aSpend, t.aSales)
                    const tBa = acosPct(t.bSpend, t.bSales)
                    const status = t.aOrders > 0 && t.bOrders > 0 ? 'Both' : t.aOrders === 0 ? 'New' : 'Lost'
                    const rec = tBa !== null && tBa < 30 ? '🚀 Scale Up' : '👁 Monitor'
                    const statusCls = status === 'Both' ? 'bg-emerald-100 text-emerald-700' : status === 'New' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    return (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 text-[11px] font-medium text-gray-700 max-w-[200px] truncate">{t.term}</td>
                        <td className="px-3 py-2 text-right text-[11px] text-blue-600 tabular-nums">{t.aOrders || '—'}</td>
                        <td className="px-3 py-2 text-right text-[11px] text-blue-600 tabular-nums">{tAa !== null ? tAa.toFixed(1) + '%' : '—'}</td>
                        <td className="px-3 py-2 text-right text-[11px] text-purple-600 font-semibold tabular-nums">{t.bOrders}</td>
                        <td className="px-3 py-2 text-right text-[11px] text-purple-600 tabular-nums">{tBa !== null ? tBa.toFixed(1) + '%' : '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>{status}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-[11px]">{rec}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Wasted terms */}
        {(wastedA.length > 0 || wastedB.length > 0) && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-amber-500 text-xs">⚠</span>
              <p className="text-xs font-semibold text-gray-700">Wasted Spend Terms</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: `A — Previous — ${wastedAAll.length} wasted terms`, wt: wastedA, extra: wastedAAll.length - wastedA.length, getSpend: (t: TermComp) => t.aSpend },
                { label: `B — Current — ${wastedBAll.length} wasted terms`,  wt: wastedB, extra: wastedBAll.length - wastedB.length, getSpend: (t: TermComp) => t.bSpend },
              ].map(({ label, wt, extra, getSpend }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
                  <p className="text-[11px] font-semibold text-gray-500 mb-2">{label}</p>
                  {wt.length === 0 ? (
                    <p className="text-[11px] text-gray-300 py-2">None</p>
                  ) : wt.map((t, i) => (
                    <div key={i} className="flex justify-between py-1 border-b border-gray-50 last:border-0">
                      <span className="text-[11px] text-gray-600 truncate max-w-[150px]">{t.term}</span>
                      <span className="text-[11px] text-red-500 font-medium tabular-nums">{fmtD(getSpend(t))}</span>
                    </div>
                  ))}
                  {extra > 0 && <p className="text-[11px] text-gray-400 mt-1.5">+{extra} more…</p>}
                </div>
              ))}
            </div>
          </div>
        )}

      </td>
    </tr>
  )
}

// ── Campaigns tab ─────────────────────────────────────────────────────────────

function CampaignsTab({ camps, terms, aStart, aEnd, bStart, bEnd }: {
  camps: CampComp[]; terms: TermComp[]
  aStart: string; aEnd: string; bStart: string; bEnd: string
}) {
  const aDays = Math.round((new Date(aEnd).getTime() - new Date(aStart).getTime()) / 86400000) + 1
  const bDays = Math.round((new Date(bEnd).getTime() - new Date(bStart).getTime()) / 86400000) + 1
  const [typeFilter, setTypeFilter] = useState<'' | 'SP' | 'SB'>('')
  const [search, setSearch] = useState('')
  const [showPaused, setShowPaused] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = useMemo(() =>
    camps
      .filter(c => !typeFilter || c.type === typeFilter)
      .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
      .filter(c => showPaused || c.state?.toLowerCase() === 'enabled'),
    [camps, typeFilter, search, showPaused]
  )

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search campaigns..."
          className="px-3 py-2 text-xs border border-gray-200 rounded-xl outline-none focus:border-orange-300 w-52"
        />
        <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
          {([['', 'All'], ['SP', 'SP'], ['SB', 'SB']] as [string, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t as '' | 'SP' | 'SB')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${typeFilter === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
            >{label}</button>
          ))}
        </div>
        <span className="text-xs text-gray-400">{filtered.length} campaigns</span>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={showPaused} onChange={e => setShowPaused(e.target.checked)} className="rounded" />
          Show paused
        </label>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <th className="w-8 px-3 py-3" />
                <th className="text-left px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Campaign</th>
                <th className="text-center px-2 py-3 text-[10px] font-semibold text-gray-400 uppercase">Type</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A ACoS</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B ACoS</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">ACoS Δ</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Spend</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Spend</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Spend Δ</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Budget</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Budget</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Sales</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Sales</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Orders</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Orders</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Orders Δ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={16} className="py-12 text-center text-sm text-gray-400">No campaigns match your filter.</td>
                </tr>
              ) : filtered.map(c => {
                const key = `${c.type}-${c.id}`
                const isExp = expanded.has(key)
                const aAcos = acosPct(c.aSpend, c.aSales)
                const bAcos = acosPct(c.bSpend, c.bSales)
                const acosDelta  = aAcos !== null && bAcos !== null ? bAcos - aAcos : null
                const spendDelta = pctChg(c.aSpend, c.bSpend)
                const ordersDelta = pctChg(c.aOrders, c.bOrders)

                return (
                  <React.Fragment key={key}>
                    <tr className={`border-b border-gray-50 hover:bg-gray-50/40 transition-colors ${isExp ? 'bg-blue-50/10' : ''}`}>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => toggleExpand(key)}
                          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors rounded hover:bg-gray-100"
                          title={isExp ? 'Collapse' : 'Expand'}
                        >
                          <span className="text-xs">{isExp ? '∧' : '›'}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <span className="font-medium text-gray-900 truncate block text-xs" title={c.name}>{c.name}</span>
                        {c.state !== 'enabled' && <span className="text-[10px] text-gray-400">({c.state})</span>}
                      </td>
                      <td className="px-2 py-2.5 text-center"><TypePill type={c.type} /></td>
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">
                        {aAcos !== null ? aAcos.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right"><AcosBadge acos={bAcos} /></td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge value={acosDelta} unit="pp" lowerIsBetter threshold={1.5} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{fmtD(c.aSpend)}</td>
                      <td className="px-3 py-2.5 text-right text-purple-700 font-semibold tabular-nums">{fmtD(c.bSpend)}</td>
                      <td className="px-3 py-2.5 text-right"><SpendDeltaBadge value={spendDelta} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {c.aBudget > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] text-blue-600">{fmtD(c.aBudget)}<span className="text-blue-400">/day</span></span>
                            <span className="text-[10px] text-gray-400">{fmtD(c.aSpend / aDays)}<span className="text-gray-300">/day avg</span></span>
                          </div>
                        ) : <span className="text-[11px] text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {c.bBudget > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[11px] text-purple-700 font-semibold">{fmtD(c.bBudget)}<span className="text-purple-400 font-normal">/day</span></span>
                            <span className="text-[10px] text-gray-400">{fmtD(c.bSpend / bDays)}<span className="text-gray-300">/day avg</span></span>
                          </div>
                        ) : <span className="text-[11px] text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{fmtD(c.aSales)}</td>
                      <td className="px-3 py-2.5 text-right text-purple-700 tabular-nums">{fmtD(c.bSales)}</td>
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{c.aOrders || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-700 font-semibold tabular-nums">{c.bOrders || '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge value={ordersDelta} unit="pct" lowerIsBetter={false} threshold={5} />
                      </td>
                    </tr>
                    {isExp && <CampExpanded camp={c} terms={terms} />}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Search Terms tab ──────────────────────────────────────────────────────────

function SearchTermsTab({ terms }: { terms: TermComp[] }) {
  const [subTab, setSubTab] = useState<'all' | 'harvest' | 'wasted'>('harvest')

  // Aggregate terms cross-campaign; track campaign with highest B spend per term
  const global = useMemo(() => {
    const map = new Map<string, {
      aSpend: number; aSales: number; aOrders: number; aClicks: number; aImp: number
      bSpend: number; bSales: number; bOrders: number; bClicks: number; bImp: number
      bestCampName: string; bestCampBSpend: number
    }>()
    for (const t of terms) {
      if (!map.has(t.term)) {
        map.set(t.term, { aSpend: 0, aSales: 0, aOrders: 0, aClicks: 0, aImp: 0, bSpend: 0, bSales: 0, bOrders: 0, bClicks: 0, bImp: 0, bestCampName: t.campaignName, bestCampBSpend: 0 })
      }
      const m = map.get(t.term)!
      m.aSpend += t.aSpend; m.aSales += t.aSales; m.aOrders += t.aOrders; m.aClicks += t.aClicks; m.aImp += t.aImp
      m.bSpend += t.bSpend; m.bSales += t.bSales; m.bOrders += t.bOrders; m.bClicks += t.bClicks; m.bImp += t.bImp
      if (t.bSpend > m.bestCampBSpend) { m.bestCampName = t.campaignName; m.bestCampBSpend = t.bSpend }
    }
    return Array.from(map.entries()).map(([term, m]) => ({ term, ...m }))
  }, [terms])

  // Sort by campaign name first, then by metric within group
  function byCampThenMetric(arr: typeof global, metric: (t: typeof global[0]) => number) {
    return [...arr].sort((a, b) => {
      const c = a.bestCampName.localeCompare(b.bestCampName)
      return c !== 0 ? c : metric(b) - metric(a)
    })
  }

  const harvest = useMemo(() => byCampThenMetric(global.filter(t => t.bOrders > 0), t => t.bOrders), [global])
  const wasted  = useMemo(() => byCampThenMetric(global.filter(t => t.bSpend > 300 && t.bOrders === 0), t => t.bSpend), [global])
  const all     = useMemo(() => byCampThenMetric(global, t => t.bSpend), [global])

  const rows = subTab === 'harvest' ? harvest : subTab === 'wasted' ? wasted : all

  const emptyMsg = subTab === 'harvest'
    ? 'No converting search terms in period B.'
    : subTab === 'wasted'
    ? 'No wasted search terms in period B (min $3 spend, 0 orders).'
    : 'No search term data for the selected periods.'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {([
          ['all',     `All (${all.length})`],
          ['harvest', `Harvest Terms (${harvest.length})`],
          ['wasted',  `Wasted Terms (${wasted.length})`],
        ] as [string, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key as typeof subTab)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
              subTab === key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* Summary stats strip */}
      {rows.length > 0 && (() => {
        const totBSpend = rows.reduce((s, t) => s + t.bSpend, 0)
        const totBSales = rows.reduce((s, t) => s + t.bSales, 0)
        const totBOrders = rows.reduce((s, t) => s + t.bOrders, 0)
        const totASpend = rows.reduce((s, t) => s + t.aSpend, 0)
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
            <span><strong className="text-gray-700">{rows.length}</strong> terms</span>
            <span className="text-gray-300">|</span>
            <span>B Spend: <strong className="text-purple-600">{fmtD(totBSpend)}</strong></span>
            <span className="text-gray-300">|</span>
            <span>B Sales: <strong className="text-purple-600">{fmtD(totBSales)}</strong></span>
            <span className="text-gray-300">|</span>
            <span>B Orders: <strong className="text-purple-600">{totBOrders}</strong></span>
            {subTab === 'wasted' && (<>
              <span className="text-gray-300">|</span>
              <span>A Spend on wasted: <strong className="text-amber-600">{fmtD(totASpend)}</strong></span>
            </>)}
          </div>
        )
      })()}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Campaign</th>
                <th className="text-left px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Search Term</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Orders</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A ACoS</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Sales</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Clicks</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Impr</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Spend</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Orders</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B ACoS</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Sales</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Clicks</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Impr</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Spend</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Change</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Status</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Recommendation</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">B Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={18} className="py-12 text-center text-sm text-gray-400">{emptyMsg}</td></tr>
              ) : rows.map((t, i) => {
                const tAa = acosPct(t.aSpend, t.aSales)
                const tBa = acosPct(t.bSpend, t.bSales)
                const acosDelta = tAa !== null && tBa !== null ? tBa - tAa : null
                const isFirstInGroup = i === 0 || rows[i - 1].bestCampName !== t.bestCampName

                // Status
                const isHarvest = t.bOrders > 0
                const isWasted  = t.bSpend > 300 && t.bOrders === 0
                let status = '—'; let statusCls = 'bg-gray-100 text-gray-400'
                if (isHarvest) {
                  if (t.aOrders > 0) { status = 'Both';  statusCls = 'bg-emerald-100 text-emerald-700' }
                  else               { status = 'New';   statusCls = 'bg-blue-100 text-blue-700' }
                  if (t.aOrders > 0 && t.bOrders === 0) { status = 'Lost'; statusCls = 'bg-amber-100 text-amber-700' }
                } else if (isWasted) {
                  if (t.aSpend > 0 && t.aOrders === 0) { status = 'Ongoing';   statusCls = 'bg-amber-50 text-amber-700 border border-amber-200' }
                  else                                   { status = 'New Issue'; statusCls = 'bg-red-50 text-red-600 border border-red-200' }
                }

                // Recommendation (harvest) & B Action (wasted)
                const rec    = isHarvest ? (tBa !== null && tBa < 25 ? '🚀 Scale Up' : t.aOrders === 0 ? '📌 Add Exact' : '👁 Monitor') : '—'
                const action = isWasted  ? (t.bSpend > 3000 ? 'Neg. Exact' : 'Monitor') : '—'
                const actionCls = t.bSpend > 3000
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'

                return (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition-colors ${isFirstInGroup && i > 0 ? 'border-t border-gray-200' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate text-[11px] font-medium align-top pt-3">
                      {isFirstInGroup ? (t.bestCampName || '—') : ''}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[180px] truncate">{t.term}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{t.aOrders || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{tAa !== null ? tAa.toFixed(1) + '%' : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{t.aSales > 0 ? fmtD(t.aSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{t.aClicks || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{t.aImp > 0 ? t.aImp.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{t.aSpend > 0 ? fmtD(t.aSpend) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{t.bOrders || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{tBa !== null ? tBa.toFixed(1) + '%' : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{t.bSales > 0 ? fmtD(t.bSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{t.bClicks || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{t.bImp > 0 ? t.bImp.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{t.bSpend > 0 ? fmtD(t.bSpend) : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <DeltaBadge value={acosDelta} unit="pp" lowerIsBetter threshold={1} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {status === '—'
                        ? <span className="text-[11px] text-gray-300">—</span>
                        : <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>{status}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5 text-right text-[11px]">{rec}</td>
                    <td className="px-4 py-2.5 text-right">
                      {action === '—'
                        ? <span className="text-[11px] text-gray-300">—</span>
                        : <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${actionCls}`}>{action}</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Keywords tab ──────────────────────────────────────────────────────────────

const MATCH_ORDER: Record<string, number> = { exact: 0, phrase: 1, broad: 2 }

function KeywordsTab({ keywords }: { keywords: KwComp[] }) {
  const [subTab, setSubTab] = useState<'all' | 'harvest' | 'wasted'>('harvest')

  function byCampThenMetric(arr: KwComp[], metric: (k: KwComp) => number) {
    return [...arr].sort((a, b) => {
      const c = a.campaignName.localeCompare(b.campaignName)
      if (c !== 0) return c
      const m = metric(b) - metric(a)
      if (m !== 0) return m
      return (MATCH_ORDER[a.matchType] ?? 9) - (MATCH_ORDER[b.matchType] ?? 9)
    })
  }

  const harvest = useMemo(() => byCampThenMetric(keywords.filter(k => k.bOrders > 0), k => k.bOrders), [keywords])
  const wasted  = useMemo(() => byCampThenMetric(keywords.filter(k => k.bSpend > 300 && k.bOrders === 0), k => k.bSpend), [keywords])
  const all     = useMemo(() => byCampThenMetric(keywords, k => k.bSpend), [keywords])

  const rows = subTab === 'harvest' ? harvest : subTab === 'wasted' ? wasted : all

  const emptyMsg = subTab === 'harvest'
    ? 'No converting keywords in period B.'
    : subTab === 'wasted'
    ? 'No wasted keywords in period B (min $3 spend, 0 orders).'
    : 'No keyword data for the selected periods.'

  const MATCH_CLS: Record<string, string> = {
    exact:  'bg-blue-50 text-blue-600',
    phrase: 'bg-amber-50 text-amber-600',
    broad:  'bg-gray-100 text-gray-500',
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {([
          ['all',     `All (${all.length})`],
          ['harvest', `Converting (${harvest.length})`],
          ['wasted',  `Wasted (${wasted.length})`],
        ] as [string, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key as typeof subTab)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
              subTab === key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >{label}</button>
        ))}
      </div>

      {rows.length > 0 && (() => {
        const totBSpend  = rows.reduce((s, k) => s + k.bSpend,  0)
        const totBSales  = rows.reduce((s, k) => s + k.bSales,  0)
        const totBOrders = rows.reduce((s, k) => s + k.bOrders, 0)
        const totASpend  = rows.reduce((s, k) => s + k.aSpend,  0)
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
            <span><strong className="text-gray-700">{rows.length}</strong> keywords</span>
            <span className="text-gray-300">|</span>
            <span>B Spend: <strong className="text-purple-600">{fmtD(totBSpend)}</strong></span>
            <span className="text-gray-300">|</span>
            <span>B Sales: <strong className="text-purple-600">{fmtD(totBSales)}</strong></span>
            <span className="text-gray-300">|</span>
            <span>B Orders: <strong className="text-purple-600">{totBOrders}</strong></span>
            {subTab === 'wasted' && (<>
              <span className="text-gray-300">|</span>
              <span>A Spend on wasted: <strong className="text-amber-600">{fmtD(totASpend)}</strong></span>
            </>)}
          </div>
        )
      })()}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Campaign</th>
                <th className="text-left px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Keyword</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Match</th>
                <th className="text-left px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Bid History</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Orders</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A ACoS</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Sales</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Clicks</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Impr</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">A Spend</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Orders</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B ACoS</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Sales</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Clicks</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Impr</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">B Spend</th>
                <th className="text-right px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Change</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Status</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={19} className="py-12 text-center text-sm text-gray-400">{emptyMsg}</td></tr>
              ) : rows.map((k, i) => {
                const kAa = acosPct(k.aSpend, k.aSales)
                const kBa = acosPct(k.bSpend, k.bSales)
                const acosDelta = kAa !== null && kBa !== null ? kBa - kAa : null
                const isFirstInGroup = i === 0 || rows[i - 1].campaignName !== k.campaignName

                const isConverting = k.bOrders > 0
                const isWasted     = k.bSpend > 300 && k.bOrders === 0
                let status = '—'; let statusCls = 'bg-gray-100 text-gray-400'
                if (isConverting) {
                  if (k.aOrders > 0) { status = 'Both'; statusCls = 'bg-emerald-100 text-emerald-700' }
                  else               { status = 'New';  statusCls = 'bg-blue-100 text-blue-700' }
                } else if (isWasted) {
                  if (k.aSpend > 0 && k.aOrders === 0) { status = 'Ongoing';   statusCls = 'bg-amber-50 text-amber-700 border border-amber-200' }
                  else                                   { status = 'New Issue'; statusCls = 'bg-red-50 text-red-600 border border-red-200' }
                }

                const action = isWasted ? (k.bSpend > 3000 ? 'Neg. Exact' : 'Lower bid') : (isConverting && kBa !== null && kBa < 25 ? 'Scale bid' : '—')
                const actionCls = isWasted
                  ? (k.bSpend > 3000 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200')
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'

                return (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition-colors ${isFirstInGroup && i > 0 ? 'border-t border-gray-200' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate text-[11px] font-medium align-top pt-3">
                      {isFirstInGroup ? (k.campaignName || '—') : ''}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[180px] truncate">{k.keywordText}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${MATCH_CLS[k.matchType] ?? 'bg-gray-100 text-gray-500'}`}>
                        {k.matchType}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px]">
                      {k.bidHistory.length === 0 ? (
                        <span className="text-[11px] text-gray-300">no data yet</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                          {k.bidHistory.map((b, bi) => (
                            <span key={bi} className="flex items-center gap-1">
                              {bi > 0 && <span className="text-gray-300 text-[10px]">→</span>}
                              <span className="text-[11px] font-semibold text-gray-800">{fmtD(b.bidCents)}</span>
                              <span className="text-[10px] text-gray-400">{fmtDate(b.date)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{k.aOrders || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{kAa !== null ? kAa.toFixed(1) + '%' : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{k.aSales > 0 ? fmtD(k.aSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{k.aClicks || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{k.aImp > 0 ? k.aImp.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{k.aSpend > 0 ? fmtD(k.aSpend) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{k.bOrders || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{kBa !== null ? kBa.toFixed(1) + '%' : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{k.bSales > 0 ? fmtD(k.bSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{k.bClicks || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{k.bImp > 0 ? k.bImp.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{k.bSpend > 0 ? fmtD(k.bSpend) : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <DeltaBadge value={acosDelta} unit="pp" lowerIsBetter threshold={1} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {status === '—'
                        ? <span className="text-[11px] text-gray-300">—</span>
                        : <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>{status}</span>
                      }
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {action === '—'
                        ? <span className="text-[11px] text-gray-300">—</span>
                        : <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${actionCls}`}>{action}</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Overlap tab ───────────────────────────────────────────────────────────────

function OverlapTab({ keywords, terms }: { keywords: KwComp[]; terms: TermComp[] }) {
  const [matchFilter, setMatchFilter] = useState<'' | 'exact' | 'phrase' | 'broad'>('')

  // Build lookup: term text (lowercase) → aggregated TermComp metrics
  const termLookup = useMemo(() => {
    const map = new Map<string, { aSpend: number; aSales: number; aOrders: number; aClicks: number; aImp: number; bSpend: number; bSales: number; bOrders: number; bClicks: number; bImp: number }>()
    for (const t of terms) {
      const key = t.term.toLowerCase().trim()
      if (!map.has(key)) map.set(key, { aSpend: 0, aSales: 0, aOrders: 0, aClicks: 0, aImp: 0, bSpend: 0, bSales: 0, bOrders: 0, bClicks: 0, bImp: 0 })
      const m = map.get(key)!
      m.aSpend += t.aSpend; m.aSales += t.aSales; m.aOrders += t.aOrders; m.aClicks += t.aClicks; m.aImp += t.aImp
      m.bSpend += t.bSpend; m.bSales += t.bSales; m.bOrders += t.bOrders; m.bClicks += t.bClicks; m.bImp += t.bImp
    }
    return map
  }, [terms])

  // Join: keep only keywords that have a matching search term
  const rows = useMemo(() => {
    return keywords
      .filter(kw => termLookup.has(kw.keywordText.toLowerCase().trim()))
      .filter(kw => !matchFilter || kw.matchType === matchFilter)
      .sort((a, b) => {
        const c = a.campaignName.localeCompare(b.campaignName)
        if (c !== 0) return c
        return b.bSpend - a.bSpend
      })
  }, [keywords, termLookup, matchFilter])

  const MATCH_CLS: Record<string, string> = {
    exact:  'bg-blue-50 text-blue-600',
    phrase: 'bg-amber-50 text-amber-600',
    broad:  'bg-gray-100 text-gray-500',
  }

  return (
    <div className="space-y-3">
      {/* Explanation banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
        <strong>Overlap</strong> = keywords you bid on whose text exactly matches a customer search term.
        For <strong>exact match</strong> the keyword and search term metrics should be nearly identical (≈100% overlap).
        For <strong>phrase/broad</strong> the keyword serves many other terms too, so keyword spend &gt; search term spend.
        The <strong>Match %</strong> column shows how much of the keyword's B spend is attributable to this one search term.
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-medium">Match type:</span>
        {([['', `All (${rows.length})`], ['exact', 'Exact'], ['phrase', 'Phrase'], ['broad', 'Broad']] as [string, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setMatchFilter(val as typeof matchFilter)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              matchFilter === val
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >{label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">No overlapping keywords and search terms found.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Campaign</th>
                  <th className="text-left px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Keyword / Search Term</th>
                  <th className="text-center px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Match</th>
                  <th className="text-left px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Bid History</th>
                  {/* Keyword metrics */}
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">KW A Spend</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">KW A ACoS</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">KW B Spend</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">KW B ACoS</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">KW B Orders</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">KW B Clicks</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">KW B Impr</th>
                  {/* Divider */}
                  <th className="px-2 py-3 text-[10px] font-semibold text-gray-300 uppercase whitespace-nowrap text-center">vs</th>
                  {/* Search term metrics */}
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">ST A Spend</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-blue-400 uppercase whitespace-nowrap">ST A ACoS</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">ST B Spend</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">ST B ACoS</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">ST B Orders</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">ST B Clicks</th>
                  <th className="text-right px-3 py-3 text-[10px] font-semibold text-purple-400 uppercase whitespace-nowrap">ST B Impr</th>
                  {/* Match quality */}
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">Match %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((kw, i) => {
                  const st = termLookup.get(kw.keywordText.toLowerCase().trim())!
                  const isFirstInGroup = i === 0 || rows[i - 1].campaignName !== kw.campaignName

                  const kwAa = acosPct(kw.aSpend, kw.aSales)
                  const kwBa = acosPct(kw.bSpend, kw.bSales)
                  const stAa = acosPct(st.aSpend, st.aSales)
                  const stBa = acosPct(st.bSpend, st.bSales)
                  const matchPct = kw.bSpend > 0 ? Math.min(100, st.bSpend / kw.bSpend * 100) : null

                  const matchCls = matchPct === null ? 'text-gray-300'
                    : matchPct >= 80 ? 'text-emerald-600 font-semibold'
                    : matchPct >= 40 ? 'text-amber-600'
                    : 'text-gray-400'

                  return (
                    <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition-colors ${isFirstInGroup && i > 0 ? 'border-t border-gray-200' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-700 max-w-[150px] truncate text-[11px] font-medium align-top pt-3">
                        {isFirstInGroup ? (kw.campaignName || '—') : ''}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[180px] truncate">{kw.keywordText}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${MATCH_CLS[kw.matchType] ?? 'bg-gray-100 text-gray-500'}`}>
                          {kw.matchType}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[180px]">
                        {kw.bidHistory.length === 0 ? (
                          <span className="text-[11px] text-gray-300">no data yet</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                            {kw.bidHistory.map((b, bi) => (
                              <span key={bi} className="flex items-center gap-1">
                                {bi > 0 && <span className="text-gray-300 text-[10px]">→</span>}
                                <span className="text-[11px] font-semibold text-gray-800">{fmtD(b.bidCents)}</span>
                                <span className="text-[10px] text-gray-400">{fmtDate(b.date)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      {/* KW metrics */}
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{kw.aSpend > 0 ? fmtD(kw.aSpend) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{kwAa !== null ? kwAa.toFixed(1) + '%' : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{kw.bSpend > 0 ? fmtD(kw.bSpend) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{kwBa !== null ? kwBa.toFixed(1) + '%' : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{kw.bOrders || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{kw.bClicks || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{kw.bImp > 0 ? kw.bImp.toLocaleString() : '—'}</td>
                      {/* Divider cell */}
                      <td className="px-2 py-2.5 text-center text-gray-200 text-xs">|</td>
                      {/* ST metrics */}
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{st.aSpend > 0 ? fmtD(st.aSpend) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-blue-600 tabular-nums">{stAa !== null ? stAa.toFixed(1) + '%' : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{st.bSpend > 0 ? fmtD(st.bSpend) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{stBa !== null ? stBa.toFixed(1) + '%' : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 font-semibold tabular-nums">{st.bOrders || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{st.bClicks || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-purple-600 tabular-nums">{st.bImp > 0 ? st.bImp.toLocaleString() : '—'}</td>
                      {/* Match % */}
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs ${matchCls}`}>
                        {matchPct !== null ? matchPct.toFixed(0) + '%' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ComparisonView({ profileId, aStart, aEnd, bStart, bEnd, camps, terms, keywords, earliestDate, chartDataA, chartDataB }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'overview' | 'campaigns' | 'search-terms' | 'keywords' | 'overlap'>('campaigns')
  const [as, setAs] = useState(aStart); const [ae, setAe] = useState(aEnd)
  const [bs, setBs] = useState(bStart); const [be, setBe] = useState(bEnd)
  const [selectedQuick, setSelectedQuick] = useState<number | null>(14)

  function applyDates() {
    const params = new URLSearchParams({
      profile_id: String(profileId),
      aStart: as, aEnd: ae, bStart: bs, bEnd: be,
    })
    router.push(`/dashboard/comparison?${params}`)
  }

  // Summary totals (all campaigns, including paused)
  const totals = useMemo(() => {
    const aSpend  = camps.reduce((s, c) => s + c.aSpend,  0)
    const bSpend  = camps.reduce((s, c) => s + c.bSpend,  0)
    const aSales  = camps.reduce((s, c) => s + c.aSales,  0)
    const bSales  = camps.reduce((s, c) => s + c.bSales,  0)
    const aOrders = camps.reduce((s, c) => s + c.aOrders, 0)
    const bOrders = camps.reduce((s, c) => s + c.bOrders, 0)
    return {
      aSpend, bSpend, aSales, bSales, aOrders, bOrders,
      aAcos: acosPct(aSpend, aSales),
      bAcos: acosPct(bSpend, bSales),
    }
  }, [camps])

  const labelA = `${fmtDate(aStart)} – ${fmtDate(aEnd)}`
  const labelB = `${fmtDate(bStart)} – ${fmtDate(bEnd)}`

  const enabledCount = camps.filter(c => c.state?.toLowerCase() === 'enabled').length
  const termCount    = new Set(terms.map(t => t.term)).size
  const kwCount      = keywords.length
  const termTextSet  = useMemo(() => new Set(terms.map(t => t.term.toLowerCase().trim())), [terms])
  const overlapCount = useMemo(() => keywords.filter(kw => termTextSet.has(kw.keywordText.toLowerCase().trim())).length, [keywords, termTextSet])

  const tabs = [
    { key: 'overview',      label: 'Overview' },
    { key: 'campaigns',     label: `Campaigns ${enabledCount}` },
    { key: 'search-terms',  label: `Search Terms ${termCount}` },
    { key: 'keywords',      label: `Keywords ${kwCount}` },
    { key: 'overlap',       label: `Overlap ${overlapCount}` },
  ]

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Period Comparison</h1>
        <p className="text-xs text-gray-400 mt-0.5">Compare two date ranges side by side</p>
      </div>

      {/* Period selectors */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {/* Quick-split buttons */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-400 font-medium">Quick split:</span>
          {[14, 30, 60].map(d => (
            <button
              key={d}
              onClick={() => {
                const q = quickSplit(d)
                setAs(q.aStart); setAe(q.aEnd); setBs(q.bStart); setBe(q.bEnd)
                setSelectedQuick(d)
                const params = new URLSearchParams({ profile_id: String(profileId), aStart: q.aStart, aEnd: q.aEnd, bStart: q.bStart, bEnd: q.bEnd })
                router.push(`/dashboard/comparison?${params}`)
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                selectedQuick === d
                  ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-600'
              }`}
            >
              {d}d
            </button>
          ))}
          {earliestDate && (
            <button
              onClick={() => {
                const q = allTimeSplit(earliestDate)
                setAs(q.aStart); setAe(q.aEnd); setBs(q.bStart); setBe(q.bEnd)
                setSelectedQuick(-1)
                const params = new URLSearchParams({ profile_id: String(profileId), aStart: q.aStart, aEnd: q.aEnd, bStart: q.bStart, bEnd: q.bEnd })
                router.push(`/dashboard/comparison?${params}`)
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                selectedQuick === -1
                  ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-600'
              }`}
            >
              All
            </button>
          )}
          <span className="text-[11px] text-gray-300 ml-1">auto-splits into A (first half) + B (second half)</span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {[
            { label: 'A (Previous)', color: 'text-blue-600 border-blue-200 bg-blue-50', s: as, setS: setAs, e: ae, setE: setAe },
            { label: 'B (Current)',  color: 'text-purple-600 border-purple-200 bg-purple-50', s: bs, setS: setBs, e: be, setE: setBe },
          ].map(({ label, color, s, setS, e, setE }) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border ${color}`}>{label}:</span>
              <input
                type="date" value={s} onChange={ev => { setS(ev.target.value); setSelectedQuick(null) }}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-300"
              />
              <span className="text-gray-400 text-xs">–</span>
              <input
                type="date" value={e} onChange={ev => { setE(ev.target.value); setSelectedQuick(null) }}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-300"
              />
            </div>
          ))}
          <button
            onClick={applyDates}
            className="px-4 py-1.5 bg-orange-500 text-white text-xs font-semibold rounded-xl hover:bg-orange-600 transition-colors shadow-sm"
          >
            Compare
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard
          label="Spend A→B"
          aStr={fmtD(totals.aSpend)}
          bStr={fmtD(totals.bSpend)}
          delta={pctChg(totals.aSpend, totals.bSpend)}
          unit="pct"
          lowerIsBetter={false}
        />
        <SummaryCard
          label="Sales A→B"
          aStr={fmtD(totals.aSales)}
          bStr={fmtD(totals.bSales)}
          delta={pctChg(totals.aSales, totals.bSales)}
          unit="pct"
          lowerIsBetter={false}
        />
        <SummaryCard
          label="ACoS A→B"
          aStr={totals.aAcos !== null ? totals.aAcos.toFixed(1) + '%' : '—'}
          bStr={totals.bAcos !== null ? totals.bAcos.toFixed(1) + '%' : '—'}
          delta={totals.aAcos !== null && totals.bAcos !== null ? totals.bAcos - totals.aAcos : null}
          unit="pp"
          lowerIsBetter
        />
        <SummaryCard
          label="Orders A→B"
          aStr={totals.aOrders.toLocaleString()}
          bStr={totals.bOrders.toLocaleString()}
          delta={pctChg(totals.aOrders, totals.bOrders)}
          unit="pct"
          lowerIsBetter={false}
        />
      </div>

      {/* Performance Chart */}
      <PerformanceChart dataA={chartDataA} dataB={chartDataB} labelA={labelA} labelB={labelB} />

      {/* Tabs */}
      <div className="border-b border-gray-100">
        <div className="flex gap-0">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-5">
          {[
            { label: 'Sponsored Products (SP)', dot: 'bg-blue-500', filter: (c: CampComp) => c.type === 'SP' },
            { label: 'Sponsored Brands (SB)',   dot: 'bg-purple-500', filter: (c: CampComp) => c.type === 'SB' },
          ].map(({ label, dot, filter }) => {
            const group = camps.filter(filter)
            const aSpend  = group.reduce((s, c) => s + c.aSpend,  0)
            const bSpend  = group.reduce((s, c) => s + c.bSpend,  0)
            const aSales  = group.reduce((s, c) => s + c.aSales,  0)
            const bSales  = group.reduce((s, c) => s + c.bSales,  0)
            const aOrders = group.reduce((s, c) => s + c.aOrders, 0)
            const bOrders = group.reduce((s, c) => s + c.bOrders, 0)
            const aAcos = acosPct(aSpend, aSales); const bAcos = acosPct(bSpend, bSales)
            return (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="text-left py-1.5 text-[10px] font-semibold text-gray-400 uppercase">Metric</th>
                      <th className="text-right py-1.5 text-[10px] font-semibold text-blue-400 uppercase">{labelA}</th>
                      <th className="text-right py-1.5 text-[10px] font-semibold text-purple-400 uppercase">{labelB}</th>
                      <th className="text-right py-1.5 text-[10px] font-semibold text-gray-400 uppercase">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { l: 'Spend',  a: fmtD(aSpend),  b: fmtD(bSpend),  delta: <SpendDeltaBadge value={pctChg(aSpend, bSpend)} /> },
                      { l: 'Sales',  a: fmtD(aSales),  b: fmtD(bSales),  delta: <DeltaBadge value={pctChg(aSales, bSales)} unit="pct" lowerIsBetter={false} threshold={3} /> },
                      { l: 'Orders', a: String(aOrders), b: String(bOrders), delta: <DeltaBadge value={pctChg(aOrders, bOrders)} unit="pct" lowerIsBetter={false} threshold={5} /> },
                      { l: 'ACoS',   a: aAcos !== null ? aAcos.toFixed(1) + '%' : '—', b: bAcos !== null ? bAcos.toFixed(1) + '%' : '—',
                        delta: <DeltaBadge value={aAcos !== null && bAcos !== null ? bAcos - aAcos : null} unit="pp" lowerIsBetter threshold={1.5} /> },
                    ].map(r => (
                      <tr key={r.l} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 text-gray-500">{r.l}</td>
                        <td className="py-2 text-right text-blue-600 tabular-nums">{r.a}</td>
                        <td className="py-2 text-right text-purple-700 font-semibold tabular-nums">{r.b}</td>
                        <td className="py-2 text-right">{r.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'campaigns' && <CampaignsTab camps={camps} terms={terms} aStart={aStart} aEnd={aEnd} bStart={bStart} bEnd={bEnd} />}
      {tab === 'search-terms' && <SearchTermsTab terms={terms} />}
      {tab === 'keywords' && <KeywordsTab keywords={keywords} />}
      {tab === 'overlap' && <OverlapTab keywords={keywords} terms={terms} />}

    </div>
  )
}
