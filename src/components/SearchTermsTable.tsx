'use client'
import { useState, useMemo } from 'react'

const adTypeCls: Record<string, string> = {
  SP: 'bg-blue-50 text-blue-600',
  SB: 'bg-purple-50 text-purple-600',
}

function termTypeBadge(matchType: string | null) {
  if (!matchType) return null
  const mt = matchType.toLowerCase()
  if (mt === 'targeting_expression' || mt === 'targeting_expression_predefined' || mt === 'substitutes' || mt === 'complements')
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 shrink-0">ASIN</span>
  if (mt === 'close-match' || mt === 'loose-match')
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">AUTO</span>
  if (mt === 'theme')
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 shrink-0">THEME</span>
  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 shrink-0">KW</span>
}

function isAsinType(mt: string | null) {
  if (!mt) return false
  const m = mt.toLowerCase()
  return m === 'targeting_expression' || m === 'targeting_expression_predefined' || m === 'substitutes' || m === 'complements'
}

interface Term {
  term: string; adType: string; matchType: string | null; targetingKeyword: string | null
  campaignId: number; campaignName: string; spend: number; sales: number
  orders: number; clicks: number; acos: number | null; cvr: number | null
}

interface Props {
  sortedGroups: [string, Term[]][]
  campaigns: string[]
  mode: string
  colCount: number
  minSpend: number
}

export default function SearchTermsTable({ sortedGroups, campaigns, mode, colCount, minSpend }: Props) {
  const [campaignSearch, setCampaignSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('all')

  const filteredGroups = useMemo(() =>
    sortedGroups.filter(([name]) => {
      const matchesSearch = !campaignSearch || name.toLowerCase().includes(campaignSearch.toLowerCase())
      const matchesFilter = campaignFilter === 'all' || name === campaignFilter
      return matchesSearch && matchesFilter
    }),
    [sortedGroups, campaignSearch, campaignFilter]
  )

  const isWasted = mode === 'wasted'

  return (
    <div className="space-y-3">
      {/* Campaign search + dropdown */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search campaigns…"
          value={campaignSearch}
          onChange={e => setCampaignSearch(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:border-orange-300"
        />
        <select
          value={campaignFilter}
          onChange={e => setCampaignFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-300 bg-white max-w-xs"
        >
          <option value="all">All campaigns</option>
          {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(campaignSearch || campaignFilter !== 'all') && (
          <button onClick={() => { setCampaignSearch(''); setCampaignFilter('all') }}
            className="text-xs text-gray-400 hover:text-gray-600">✕ Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Search Term</th>
                <th className="text-left px-3 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Triggered By</th>
                <th className="text-center px-3 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Spend</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Sales</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">ACOS</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Orders</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Clicks</th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">CVR</th>
                {isWasted && <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-5 py-16 text-center text-sm text-gray-400">
                    {mode === 'wasted' ? `No search terms with >$${minSpend} spend and zero sales.` :
                     mode === 'converters' ? 'No converting terms with ACOS ≤ 15% and 2+ orders.' :
                     'No search term data for this period.'}
                  </td>
                </tr>
              ) : filteredGroups.map(([campaignName, groupTerms]) => (
                <>
                  {(() => {
                    const gSpend  = groupTerms.reduce((s, t) => s + t.spend, 0)
                    const gSales  = groupTerms.reduce((s, t) => s + t.sales, 0)
                    const gOrders = groupTerms.reduce((s, t) => s + t.orders, 0)
                    const gClicks = groupTerms.reduce((s, t) => s + t.clicks, 0)
                    const gAcos   = gSales > 0 ? Math.round(gSpend / gSales * 1000) / 10 : null
                    const gCvr    = gClicks > 0 ? Math.round(gOrders / gClicks * 10000) / 100 : null
                    return (
                      <tr key={`h-${campaignName}`} className="bg-gray-100 border-y border-gray-200 first:border-t-0 font-bold text-gray-900">
                        <td colSpan={3} className="px-5 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-900 uppercase tracking-wide truncate">{campaignName}</span>
                            <span className="text-[10px] text-gray-500 shrink-0 bg-gray-200 rounded px-1.5 py-0.5">{groupTerms.length}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">${gSpend.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">${gSales.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{gAcos !== null ? gAcos + '%' : '—'}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{gOrders}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{gClicks}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{gCvr !== null ? gCvr + '%' : '—'}</td>
                        {isWasted && <td className="px-5 py-2"></td>}
                      </tr>
                    )
                  })()}
                  {groupTerms.map((t, i) => (
                    <tr key={`${t.campaignId}-${i}`} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 font-medium text-gray-900 max-w-xs">
                        <span className="block truncate pl-8 pr-4" title={t.term}>{t.term}</span>
                      </td>
                      <td className="px-3 py-3 max-w-[180px]">
                        {t.targetingKeyword
                          ? <span className="block truncate text-xs text-gray-500" title={t.targetingKeyword}>{t.targetingKeyword}</span>
                          : t.matchType?.includes('match') || t.matchType?.includes('substitutes') || t.matchType?.includes('complements')
                            ? <span className="text-xs text-gray-400 italic">{t.matchType}</span>
                            : <span className="text-gray-300 text-xs">—</span>
                        }
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${adTypeCls[t.adType] ?? ''}`}>{t.adType}</span>
                          {termTypeBadge(t.matchType)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">${t.spend.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">${t.sales.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        {t.acos !== null ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg border ${
                            t.acos < 25 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            t.acos < 50 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                          'bg-red-50 text-red-600 border-red-200'
                          }`}>{t.acos}%</span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{t.orders}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{t.clicks}</td>
                      <td className="px-4 py-3 text-right text-gray-400 tabular-nums">
                        {t.cvr !== null ? `${t.cvr}%` : <span className="text-gray-300">—</span>}
                      </td>
                      {isWasted && (
                        <td className="px-5 py-3 text-right">
                          {isAsinType(t.matchType) ? (
                            <span title="Add as Negative Product Target" className="text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-teal-100 transition-colors">
                              + Neg Target
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-red-100 transition-colors">
                              + Negative
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
