'use client'

import { useState } from 'react'
import ChangeHistoryChart, { fmtValue } from './ChangeHistoryChart'
import ChangesView, { type ChangeEvent } from './ChangesView'

type Pt = { ts: string; old_value: number | null; new_value: number | null }
type Perf = { spend_cents: number; sales_cents: number; orders: number; clicks: number }
export type AdGroupRow = { ad_group_id: string; name: string; state: string; default_bid_cents: number; bidEvents: Pt[] } & Perf
export type PlacementRow = { key: string; label: string; current: number; events: Pt[] } & Perf
export type StrategyInfo = { current: string | null; changes: { ts: string; from: string | null; to: string | null }[] }

const fmtD = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const acosOf = (p: Perf) => p.sales_cents > 0 ? (p.spend_cents / p.sales_cents * 100).toFixed(1) + '%' : '—'

const STRATEGY_LABEL: Record<string, string> = {
  LEGACY_FOR_SALES: 'Dynamic bids – down only',
  AUTO_FOR_SALES:   'Dynamic bids – up and down',
  MANUAL:           'Fixed bids',
  RULE_BASED:       'Rule-based bidding',
}
const strat = (s: string | null) => s ? (STRATEGY_LABEL[s] ?? s) : '—'

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TABS = [
  { key: 'adgroups',   label: 'Ad Groups' },
  { key: 'placements', label: 'Placements' },
  { key: 'bidding',    label: 'Bidding' },
  { key: 'changes',    label: 'Changes' },
] as const

export default function CampaignDetailTabs({
  adType, adGroups, placements, strategy, changeEvents,
}: {
  adType: string
  adGroups: AdGroupRow[]
  placements: PlacementRow[]
  strategy: StrategyInfo
  changeEvents: ChangeEvent[]
}) {
  const [tab, setTab] = useState<string>('adgroups')
  const isSP = adType === 'SP'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-100 px-3 pt-3">
        {TABS.filter(t => isSP || t.key === 'changes' || t.key === 'adgroups').map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${tab === t.key ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-500 -mb-px' : 'text-gray-500 hover:text-gray-800'}`}>
            {t.label}
            {t.key === 'adgroups' && <span className="ml-1.5 text-xs opacity-60">{adGroups.length}</span>}
            {t.key === 'changes'  && <span className="ml-1.5 text-xs opacity-60">{changeEvents.length}</span>}
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
                    <th className="px-3 py-2 font-medium">Ad group</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium text-right">Default bid</th>
                    <th className="px-3 py-2 font-medium text-right">Spend</th>
                    <th className="px-3 py-2 font-medium text-right">Sales</th>
                    <th className="px-3 py-2 font-medium text-right">ACoS</th>
                    <th className="px-3 py-2 font-medium text-right">Orders</th>
                    <th className="px-3 py-2 font-medium text-right">Bid changes</th>
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
                        {a.bidEvents.length > 0
                          ? <div className="w-44 ml-auto"><ChangeHistoryChart events={a.bidEvents} kind="cents" height={70} /></div>
                          : <span className="text-xs text-gray-300">no changes yet</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Placements */}
        {tab === 'placements' && (
          !isSP ? <Empty msg="Placement bidding is a Sponsored Products feature." /> : (
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
                      <div key={l as string}>
                        <div className="text-[11px] font-semibold text-gray-800 tabular-nums">{v}</div>
                        <div className="text-[9px] text-gray-400 uppercase">{l}</div>
                      </div>
                    ))}
                  </div>
                  {p.events.length > 0
                    ? <ChangeHistoryChart events={p.events} kind="percent" color="#0d9488" height={90} />
                    : <div className="text-xs text-gray-300 py-4 text-center">no adjustment changes yet</div>}
                </div>
              ))}
            </div>
          )
        )}

        {/* Bidding */}
        {tab === 'bidding' && (
          !isSP ? <Empty msg="Bidding strategy detail is available for Sponsored Products." /> : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">Current strategy:</span>
                <span className="text-sm font-semibold text-purple-700 bg-purple-50 px-3 py-1 rounded-full">{strat(strategy.current)}</span>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-2">Strategy change history</div>
                {strategy.changes.length === 0 ? (
                  <p className="text-xs text-gray-400">No strategy changes recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {strategy.changes.map((c, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="text-xs text-gray-400 w-28 shrink-0">{fmtDate(c.ts)}</span>
                        <span className="text-gray-400">{strat(c.from)}</span>
                        <span className="text-gray-300">→</span>
                        <span className="font-semibold text-gray-900">{strat(c.to)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {/* Changes — reuse ChangesView */}
        {tab === 'changes' && (
          <ChangesView events={changeEvents} source={changeEvents.some(e => e.source === 'api') ? 'mixed' : 'snapshot'} />
        )}
      </div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-10 text-center text-sm text-gray-400">{msg}</div>
}
