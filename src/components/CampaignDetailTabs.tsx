'use client'

import React, { useState, useTransition } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import ChangeHistoryChart, { fmtValue } from './ChangeHistoryChart'
import ChangesView, { type ChangeEvent } from './ChangesView'
import { getBidHistory } from '@/app/dashboard/targeting/actions'

type Pt = { ts: string; old_value: number | null; new_value: number | null }
type Perf = { spend_cents: number; sales_cents: number; orders: number; clicks: number }
export type AdGroupRow = { ad_group_id: string; name: string; state: string; default_bid_cents: number; bidEvents: Pt[] } & Perf
export type PlacementRow = { key: string; label: string; current: number; events: Pt[] } & Perf
export type StrategyInfo = { current: string | null; changes: { ts: string; from: string | null; to: string | null }[] }
export type TargetRow = { keyword_id: number; text: string; match_type: string; state: string; bid_cents: number; prev_bid_cents: number | null } & Perf
export type STRow = { term: string; keyword_id: number | null; ad_type: string; bid_cents: number | null; prev_bid_cents?: number | null; targeting: string | null } & Perf

const fmtD = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const acosOf = (p: Perf) => p.sales_cents > 0 ? (p.spend_cents / p.sales_cents * 100).toFixed(1) + '%' : '—'

const STRATEGY_LABEL: Record<string, string> = {
  LEGACY_FOR_SALES: 'Dynamic bids – down only', AUTO_FOR_SALES: 'Dynamic bids – up and down',
  MANUAL: 'Fixed bids', RULE_BASED: 'Rule-based bidding',
}
const strat = (s: string | null) => s ? (STRATEGY_LABEL[s] ?? s) : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function matchBadge(mt: string) {
  const m = (mt ?? '').toLowerCase()
  const cls = m === 'exact' ? 'bg-blue-50 text-blue-700' : m === 'phrase' ? 'bg-purple-50 text-purple-700'
    : m === 'broad' ? 'bg-gray-100 text-gray-600' : m.startsWith('targeting_expression') ? 'bg-teal-50 text-teal-700'
    : 'bg-amber-50 text-amber-700'
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>{mt}</span>
}

export default function CampaignDetailTabs({
  adType, adGroups, placements, strategy, changeEvents, targets, searchTerms,
}: {
  adType: string
  adGroups: AdGroupRow[]
  placements: PlacementRow[]
  strategy: StrategyInfo
  changeEvents: ChangeEvent[]
  targets: TargetRow[]
  searchTerms: STRow[]
}) {
  const [tab, setTab] = useState<'adgroups' | 'searchterms' | 'targets'>('adgroups')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [bidHistory, setBidHistory] = useState<{ date: string; bid: number }[]>([])
  const [loadingBid, setLoadingBid] = useState(false)
  const [, startTransition] = useTransition()
  const isSP = adType === 'SP'

  const handleExpandBid = (rowKey: string, keywordId: number, at: string) => {
    if (expanded === rowKey) { setExpanded(null); return }
    setExpanded(rowKey); setLoadingBid(true)
    startTransition(async () => {
      const hist = await getBidHistory(keywordId, at.toLowerCase() === 'sb' ? 'sb' : 'sp')
      setBidHistory(hist); setLoadingBid(false)
    })
  }

  const TABS = [
    { key: 'adgroups',    label: 'Ad Groups',    n: adGroups.length },
    { key: 'searchterms', label: 'Search Terms', n: searchTerms.length },
    { key: 'targets',     label: 'Targets',      n: targets.length },
  ] as const

  const bidHistoryRow = (rowKey: string, colSpan: number) => expanded === rowKey && (
    <tr className="bg-orange-50/20 border-b border-orange-100">
      <td colSpan={colSpan} className="px-8 py-4">
        {loadingBid ? <p className="text-xs text-gray-400">Loading bid history…</p>
          : bidHistory.length === 0 ? <p className="text-xs text-gray-400">No bid history recorded yet.</p>
          : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">Bid History</p>
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bidHistory}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => '$' + v.toFixed(2)} width={45} />
                    <Tooltip formatter={(v: number) => ['$' + v.toFixed(2), 'Bid']} labelFormatter={l => 'Date: ' + l} />
                    <Line type="monotone" dataKey="bid" stroke="#f97316" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-6 text-xs text-gray-500">
                <span>Current: <strong className="text-gray-800">${bidHistory[bidHistory.length - 1]?.bid.toFixed(2)}</strong></span>
                <span>Lowest: <strong className="text-gray-800">${Math.min(...bidHistory.map(h => h.bid)).toFixed(2)}</strong></span>
                <span>Highest: <strong className="text-gray-800">${Math.max(...bidHistory.map(h => h.bid)).toFixed(2)}</strong></span>
              </div>
            </div>
          )}
      </td>
    </tr>
  )

  const BidLastCurrent = ({ prev, cur }: { prev: number | null; cur: number }) =>
    (prev != null && prev !== cur)
      ? <span className="whitespace-nowrap"><span className="text-gray-400">{fmtD(prev)}</span><span className="text-gray-300 mx-1">→</span><span className={cur > prev ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{fmtD(cur)}</span></span>
      : <span className="text-gray-700">{fmtD(cur)}</span>

  return (
    <div className="space-y-6">
      {/* ── Tabbed: Ad Groups / Search Terms / Targets ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-1 border-b border-gray-100 px-3 pt-3">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${tab === t.key ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-500 -mb-px' : 'text-gray-500 hover:text-gray-800'}`}>
              {t.label}<span className="ml-1.5 text-xs opacity-60">{t.n}</span>
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* Ad Groups */}
          {tab === 'adgroups' && (
            adGroups.length === 0 ? <Empty msg="No ad groups captured yet." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-2 font-medium">Ad group</th><th className="px-3 py-2 font-medium">State</th>
                      <th className="px-3 py-2 font-medium text-right">Default bid</th><th className="px-3 py-2 font-medium text-right">Spend</th>
                      <th className="px-3 py-2 font-medium text-right">Sales</th><th className="px-3 py-2 font-medium text-right">ACoS</th>
                      <th className="px-3 py-2 font-medium text-right">Orders</th><th className="px-3 py-2 font-medium text-right">Bid changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adGroups.map(a => (
                      <tr key={a.ad_group_id} className="border-b border-gray-50 align-top">
                        <td className="px-3 py-2.5 font-medium text-gray-900">{a.name}</td>
                        <td className="px-3 py-2.5"><span className="text-[11px] text-gray-500 capitalize">{a.state}</span></td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">${(a.default_bid_cents / 100).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{a.spend_cents ? fmtD(a.spend_cents) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{a.sales_cents ? fmtD(a.sales_cents) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{acosOf(a)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{a.orders || '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          {a.bidEvents.length > 0 ? <div className="w-44 ml-auto"><ChangeHistoryChart events={a.bidEvents} kind="cents" height={70} /></div> : <span className="text-xs text-gray-300">no changes yet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Targets (keywords + product/auto targets) */}
          {tab === 'targets' && (
            targets.length === 0 ? <Empty msg="No targets for this campaign in range." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-2 font-medium">Keyword / Target</th><th className="px-3 py-2 font-medium">Match</th>
                      <th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium">Bid</th>
                      <th className="px-3 py-2 font-medium text-right">Spend</th><th className="px-3 py-2 font-medium text-right">Sales</th>
                      <th className="px-3 py-2 font-medium text-right">ACoS</th><th className="px-3 py-2 font-medium text-right">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map(t => { const rk = `t-${t.keyword_id}`; return (
                      <React.Fragment key={rk}>
                        <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[260px] truncate" title={t.text}>{t.text || '—'}</td>
                          <td className="px-3 py-2.5">{matchBadge(t.match_type)}</td>
                          <td className="px-3 py-2.5"><span className="text-[11px] text-gray-500 capitalize">{t.state}</span></td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {t.bid_cents ? <button onClick={() => handleExpandBid(rk, t.keyword_id, adType)} className="hover:underline hover:text-orange-600"><BidLastCurrent prev={t.prev_bid_cents} cur={t.bid_cents} /></button> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{t.spend_cents ? fmtD(t.spend_cents) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{t.sales_cents ? fmtD(t.sales_cents) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{acosOf(t)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{t.orders || '—'}</td>
                        </tr>
                        {bidHistoryRow(rk, 8)}
                      </React.Fragment>
                    )})}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Search Terms */}
          {tab === 'searchterms' && (
            searchTerms.length === 0 ? <Empty msg="No search terms for this campaign in range." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-2 font-medium">Search term</th><th className="px-3 py-2 font-medium">Triggered by</th>
                      <th className="px-3 py-2 font-medium">Bid</th><th className="px-3 py-2 font-medium text-right">Spend</th>
                      <th className="px-3 py-2 font-medium text-right">Sales</th><th className="px-3 py-2 font-medium text-right">ACoS</th>
                      <th className="px-3 py-2 font-medium text-right">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchTerms.map((s, i) => { const rk = `s-${i}`; return (
                      <React.Fragment key={rk}>
                        <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[260px] truncate" title={s.term}>{s.term}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[160px] truncate">{s.targeting || '—'}</td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {s.bid_cents != null && s.keyword_id ? <button onClick={() => handleExpandBid(rk, s.keyword_id!, s.ad_type)} className="hover:underline hover:text-orange-600"><BidLastCurrent prev={s.prev_bid_cents ?? null} cur={s.bid_cents} /></button> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{s.spend_cents ? fmtD(s.spend_cents) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{s.sales_cents ? fmtD(s.sales_cents) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{acosOf(s)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{s.orders || '—'}</td>
                        </tr>
                        {bidHistoryRow(rk, 7)}
                      </React.Fragment>
                    )})}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Stacked sections: Placements · Bidding · Changes (always visible) ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Placements</h2>
        {!isSP ? <Empty msg="Placement bidding is a Sponsored Products feature." /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {placements.map(p => (
              <div key={p.key} className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-gray-700">{p.label}</span>
                  <span className="text-lg font-bold text-teal-600 tabular-nums">{p.current > 0 ? `+${p.current}%` : '0%'}</span>
                </div>
                <div className="text-[11px] text-gray-400 mb-2">{p.events.length} change{p.events.length === 1 ? '' : 's'}</div>
                <div className="grid grid-cols-4 gap-1 mb-3 text-center">
                  {[['Spend', p.spend_cents ? fmtD(p.spend_cents) : '—'], ['Sales', p.sales_cents ? fmtD(p.sales_cents) : '—'], ['ACoS', acosOf(p)], ['Orders', p.orders || '—']].map(([l, v]) => (
                    <div key={l as string}><div className="text-[11px] font-semibold text-gray-800 tabular-nums">{v}</div><div className="text-[9px] text-gray-400 uppercase">{l}</div></div>
                  ))}
                </div>
                {p.events.length > 0 ? <ChangeHistoryChart events={p.events} kind="percent" color="#0d9488" height={90} /> : <div className="text-xs text-gray-300 py-4 text-center">no adjustment changes yet</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Bidding</h2>
        {!isSP ? <Empty msg="Bidding-strategy detail is available for Sponsored Products." /> : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">Current strategy:</span>
              <span className="text-sm font-semibold text-purple-700 bg-purple-50 px-3 py-1 rounded-full">{strat(strategy.current)}</span>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-2">Strategy change history</div>
              {strategy.changes.length === 0 ? <p className="text-xs text-gray-400">No strategy changes recorded yet.</p> : (
                <div className="space-y-2">
                  {strategy.changes.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-xs text-gray-400 w-28 shrink-0">{fmtDate(c.ts)}</span>
                      <span className="text-gray-400">{strat(c.from)}</span><span className="text-gray-300">→</span>
                      <span className="font-semibold text-gray-900">{strat(c.to)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Changes <span className="font-normal text-gray-400">({changeEvents.length})</span></h2>
        <ChangesView events={changeEvents} source={changeEvents.some(e => e.source === 'api') ? 'mixed' : 'snapshot'} />
      </div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-10 text-center text-sm text-gray-400">{msg}</div>
}
