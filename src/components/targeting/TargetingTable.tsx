'use client'
import { useState, useMemo, useTransition } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getBidHistory } from '@/app/dashboard/targeting/actions'

function fmt$(cents: number) { return '$' + (cents / 100).toFixed(2) }
function acosColor(acos: number | null) {
  if (acos === null) return 'text-gray-400'
  if (acos > 50) return 'text-red-600 font-semibold'
  if (acos < 25) return 'text-green-600 font-semibold'
  return 'text-amber-600 font-semibold'
}

function matchBadge(mt: string) {
  const m = mt.toLowerCase()
  const cls =
    m === 'exact'   ? 'bg-blue-50 text-blue-700' :
    m === 'phrase'  ? 'bg-purple-50 text-purple-700' :
    m === 'broad'   ? 'bg-gray-100 text-gray-600' :
    m === 'theme'   ? 'bg-violet-50 text-violet-700' :
    m === 'close-match' || m === 'loose-match' || m === 'substitutes' || m === 'complements'
                    ? 'bg-amber-50 text-amber-700' :
    m.startsWith('targeting_expression') ? 'bg-teal-50 text-teal-700' :
    m.startsWith('negative') ? 'bg-rose-50 text-rose-700' :
    'bg-gray-100 text-gray-500'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{mt}</span>
}

function targetTypeLabel(mt: string, text: string) {
  const m = mt.toLowerCase()
  if (m === 'close-match')   return 'Close Match (auto)'
  if (m === 'loose-match')   return 'Loose Match (auto)'
  if (m === 'substitutes')   return 'Substitutes (auto)'
  if (m === 'complements')   return 'Complements (auto)'
  if (m === 'targeting_expression_predefined') return text || 'Category target'
  if (m.startsWith('targeting_expression')) {
    const asin = text.match(/asin="?([A-Z0-9]{10})"?/i)
    return asin ? asin[1] : (text || 'ASIN target')
  }
  return text || '—'
}

type KwRow = {
  keyword_id: number; keyword_text: string; match_type: string; state: string
  bid_cents: number; impressions: number; clicks: number; spend_cents: number
  sales_cents: number; orders: number; campaign_id: number; campaignName: string
}
type NegRow = {
  keyword_id?: number; target_id?: number; keyword_text?: string; expression?: string
  match_type: string; state: string; campaign_id: number; ad_group_id?: number
  campaignName: string; level: string; type: 'keyword' | 'target'
}

interface Props {
  adType: 'sp' | 'sb'
  tab: string
  activeTab: string
  sortedGroups: [string, KwRow[]][]
  negGroups: [string, NegRow[]][]
  campaigns: string[]
  buildUrl: (p: Record<string, string | undefined>) => string
}

export default function TargetingTable({ adType, tab, activeTab, sortedGroups, negGroups, campaigns, buildUrl }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [bidHistory, setBidHistory] = useState<{ date: string; bid: number }[]>([])
  const [loadingBid, setLoadingBid] = useState(false)
  const [campaignSearch, setCampaignSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [, startTransition] = useTransition()

  const handleExpand = (kwId: number) => {
    if (expanded === kwId) { setExpanded(null); return }
    setExpanded(kwId)
    setLoadingBid(true)
    startTransition(async () => {
      const hist = await getBidHistory(kwId, adType)
      setBidHistory(hist)
      setLoadingBid(false)
    })
  }

  const filteredGroups = useMemo(() => {
    const groups = activeTab === 'negatives' ? negGroups : sortedGroups
    return (groups as [string, any[]][]).filter(([name]) => {
      const matchesSearch = !campaignSearch || name.toLowerCase().includes(campaignSearch.toLowerCase())
      const matchesFilter = campaignFilter === 'all' || name === campaignFilter
      return matchesSearch && matchesFilter
    })
  }, [sortedGroups, negGroups, campaignSearch, campaignFilter, activeTab])

  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'keywords', label: 'Keywords' },
    { key: 'products', label: 'Product Targets' },
    ...(adType === 'sp' ? [{ key: 'auto', label: 'Auto Targets' }] : []),
    { key: 'negatives', label: 'Negatives' },
  ]

  const isNeg = activeTab === 'negatives'

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 w-fit shadow-sm">
        {tabs.map(t => (
          <a key={t.key} href={buildUrl({ tab: t.key })}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === t.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >{t.label}</a>
        ))}
      </div>

      {/* Campaign filter */}
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
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-300 bg-white"
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {isNeg ? (
                  <>
                    {['Keyword / Target','Match Type','Level','State'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </>
                ) : (
                  <>
                    {['Keyword / Target','Match','State','Bid','Impr.','Clicks','Spend','Sales','Orders','ACOS'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <tr><td colSpan={isNeg ? 4 : 10} className="px-4 py-16 text-center text-sm text-gray-400">No data for this filter.</td></tr>
              ) : filteredGroups.map(([campaignName, rows]) => (
                <>
                  {/* Campaign header */}
                  <tr key={`h-${campaignName}`} className="bg-gray-50 border-y border-gray-100">
                    <td colSpan={isNeg ? 4 : 10} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide truncate">{campaignName}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-200 rounded px-1.5 py-0.5">{rows.length}</span>
                      </div>
                    </td>
                  </tr>

                  {/* Rows */}
                  {isNeg
                    ? (rows as NegRow[]).map((neg, i) => (
                        <tr key={`${neg.campaign_id}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-gray-900 max-w-[280px]">
                            <span className="block truncate pl-6">{neg.type === 'target'
                              ? (neg.expression ? JSON.parse(neg.expression)[0]?.value ?? neg.expression : '—')
                              : (neg.keyword_text || '—')}
                            </span>
                          </td>
                          <td className="px-4 py-3">{matchBadge(neg.match_type)}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{neg.level}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${neg.state === 'enabled' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {neg.state}
                            </span>
                          </td>
                        </tr>
                      ))
                    : (rows as KwRow[]).map(kw => {
                        const acos = kw.sales_cents > 0 ? kw.spend_cents / kw.sales_cents * 100 : null
                        const isExpanded = expanded === kw.keyword_id
                        return (
                          <>
                            <tr key={kw.keyword_id}
                              onClick={() => handleExpand(kw.keyword_id)}
                              className="border-b border-gray-50 hover:bg-orange-50/30 transition-colors cursor-pointer">
                              <td className="py-3 max-w-[280px]">
                                <span className="block truncate pl-6 pr-4 font-medium text-gray-900">
                                  {targetTypeLabel(kw.match_type, kw.keyword_text)}
                                </span>
                              </td>
                              <td className="px-4 py-3">{matchBadge(kw.match_type)}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${kw.state === 'enabled' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {kw.state}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-700 tabular-nums">
                                {kw.bid_cents ? fmt$(kw.bid_cents) : '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-700 tabular-nums">{kw.impressions.toLocaleString()}</td>
                              <td className="px-4 py-3 text-gray-700 tabular-nums">{kw.clicks.toLocaleString()}</td>
                              <td className="px-4 py-3 text-gray-700 tabular-nums">{fmt$(kw.spend_cents)}</td>
                              <td className="px-4 py-3 text-gray-700 tabular-nums">{fmt$(kw.sales_cents)}</td>
                              <td className="px-4 py-3 text-gray-700 tabular-nums">{kw.orders}</td>
                              <td className={`px-4 py-3 tabular-nums ${acosColor(acos)}`}>
                                {acos !== null ? acos.toFixed(1) + '%' : '—'}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${kw.keyword_id}-hist`} className="bg-orange-50/20 border-b border-orange-100">
                                <td colSpan={10} className="px-8 py-4">
                                  {loadingBid ? (
                                    <p className="text-xs text-gray-400">Loading bid history…</p>
                                  ) : bidHistory.length === 0 ? (
                                    <p className="text-xs text-gray-400">No bid history recorded yet.</p>
                                  ) : (
                                    <div className="space-y-3">
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
                                        <span>{bidHistory.length} data points</span>
                                      </div>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })
                  }
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
