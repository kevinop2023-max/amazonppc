import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import DateRangePicker from '@/components/DateRangePicker'
import SearchTermsTable from '@/components/SearchTermsTable'

export const revalidate = 0

export default async function SearchTermsPage({
  searchParams,
}: {
  searchParams: { profile_id?: string; days?: string; mode?: string; min_spend?: string; adType?: string; start?: string; end?: string }
}) {
  const supabase  = await createClient()
  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null
  const isAllTime = searchParams.days === 'all'
  const days      = isAllTime ? 0 : Number(searchParams.days ?? 30)
  const mode      = (searchParams.mode ?? 'all') as 'all' | 'wasted' | 'converters'
  const minSpend  = Number(searchParams.min_spend ?? 5)
  const adType    = searchParams.adType ?? 'all'
  const isCustom  = !!(searchParams.start && searchParams.end)
  const startStr  = searchParams.start ?? (isAllTime ? '2020-01-01' : new Date(Date.now() - days * 86400000).toISOString().split('T')[0])
  const endStr    = searchParams.end ?? new Date(Date.now() - 86400000).toISOString().split('T')[0]

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  // Round 1: search term rows (include campaign_id for grouping)
  const [spRes, sbRes] = await Promise.all([
    adType !== 'SB'
      ? supabase.from('sp_search_terms').select('campaign_id, customer_search_term, match_type, targeting_keyword, impressions, clicks, spend_cents, sales_cents, orders').eq('profile_id', profileId).gte('date', startStr).lte('date', endStr).range(0, 49999)
      : Promise.resolve({ data: [] as any[] }),
    adType !== 'SP'
      ? supabase.from('sb_search_terms').select('campaign_id, customer_search_term, match_type, targeting_keyword, impressions, clicks, spend_cents, sales_cents, orders').eq('profile_id', profileId).gte('date', startStr).lte('date', endStr).range(0, 49999)
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Aggregate by (adType, campaignId, term) — same term in different campaigns = separate rows
  type TermAgg = { adType: string; campaignId: number; term: string; matchType: string | null; targetingKeyword: string | null; spend: number; sales: number; orders: number; clicks: number; impressions: number }
  const map = new Map<string, TermAgg>()

  function addRows(rows: any[] | null, adType: string) {
    for (const r of rows ?? []) {
      const key = `${adType}|${r.campaign_id}|${r.customer_search_term}`
      if (!map.has(key)) map.set(key, { adType, campaignId: Number(r.campaign_id), term: r.customer_search_term ?? '', matchType: r.match_type ?? null, targetingKeyword: r.targeting_keyword ?? null, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 })
      const a = map.get(key)!
      a.spend       += r.spend_cents
      a.sales       += r.sales_cents
      a.orders      += r.orders
      a.clicks      += r.clicks
      a.impressions += r.impressions
    }
  }
  addRows(spRes.data, 'SP')
  addRows(sbRes.data, 'SB')

  // Round 2: fetch campaign names for the found campaign IDs
  const spCids = [...new Set((spRes.data ?? []).map((r: any) => r.campaign_id).filter(Boolean))]
  const sbCids = [...new Set((sbRes.data ?? []).map((r: any) => r.campaign_id).filter(Boolean))]

  const [spCampRes, sbCampRes] = await Promise.all([
    spCids.length > 0
      ? supabase.from('sp_campaigns').select('campaign_id, campaign_name').eq('profile_id', profileId).in('campaign_id', spCids).order('date', { ascending: false }).range(0, 4999)
      : Promise.resolve({ data: [] as { campaign_id: number; campaign_name: string }[] }),
    sbCids.length > 0
      ? supabase.from('sb_campaigns').select('campaign_id, campaign_name').eq('profile_id', profileId).in('campaign_id', sbCids).order('date', { ascending: false }).range(0, 4999)
      : Promise.resolve({ data: [] as { campaign_id: number; campaign_name: string }[] }),
  ])

  const campaignNames = new Map<string, string>()
  for (const c of spCampRes.data ?? []) { const k = `SP|${c.campaign_id}`; if (!campaignNames.has(k)) campaignNames.set(k, c.campaign_name) }
  for (const c of sbCampRes.data ?? []) { const k = `SB|${c.campaign_id}`; if (!campaignNames.has(k)) campaignNames.set(k, c.campaign_name) }

  let terms = Array.from(map.values()).map(t => ({
    term:             t.term,
    adType:           t.adType,
    matchType:        t.matchType,
    targetingKeyword: t.targetingKeyword,
    campaignId:       t.campaignId,
    campaignName: campaignNames.get(`${t.adType}|${t.campaignId}`) ?? `Campaign ${t.campaignId}`,
    spend:  t.spend / 100,
    sales:  t.sales / 100,
    orders: t.orders,
    clicks: t.clicks,
    acos:   t.sales > 0  ? Math.round(t.spend / t.sales * 1000) / 10 : null,
    roas:   t.spend > 0  ? Math.round(t.sales / t.spend * 100) / 100 : null,
    cvr:    t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : null,
  }))

  if (mode === 'wasted')          terms = terms.filter(t => t.sales === 0 && t.spend >= minSpend).sort((a, b) => b.spend - a.spend)
  else if (mode === 'converters') terms = terms.filter(t => t.orders >= 2 && t.acos !== null && t.acos <= 15).sort((a, b) => b.orders - a.orders)
  else                            terms.sort((a, b) => b.spend - a.spend)

  // Group by campaign name, sort groups by total spend desc
  const grouped = new Map<string, typeof terms>()
  for (const t of terms) {
    if (!grouped.has(t.campaignName)) grouped.set(t.campaignName, [])
    grouped.get(t.campaignName)!.push(t)
  }
  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    b[1].reduce((s, t) => s + t.spend, 0) - a[1].reduce((s, t) => s + t.spend, 0)
  )
  const allCampaigns = sortedGroups.map(([name]) => name)

  // ASIN/product-target match types need a Negative PRODUCT TARGET, not a negative keyword
  function isAsinType(mt: string | null) {
    if (!mt) return false
    const m = mt.toLowerCase()
    return m === 'targeting_expression' || m === 'targeting_expression_predefined' ||
           m === 'substitutes' || m === 'complements'
  }

  const totalWaste      = mode === 'wasted' ? terms.reduce((s, t) => s + t.spend, 0) : null
  const wastedKwCount   = mode === 'wasted' ? terms.filter(t => !isAsinType(t.matchType)).length : 0
  const wastedAsinCount = mode === 'wasted' ? terms.filter(t => isAsinType(t.matchType)).length : 0
  const colCount        = mode === 'wasted' ? 10 : 9

  // Match type badge — distinguishes customer queries from ASIN matches and auto-targeting
  function termTypeBadge(matchType: string | null) {
    if (!matchType) return null
    const mt = matchType.toLowerCase()
    if (mt === 'targeting_expression' || mt === 'targeting_expression_predefined')
      return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 shrink-0">ASIN</span>
    if (mt === 'substitutes' || mt === 'complements')
      return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 shrink-0">ASIN</span>
    if (mt === 'close-match' || mt === 'loose-match')
      return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">AUTO</span>
    if (mt === 'theme')
      return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 shrink-0">THEME</span>
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 shrink-0">KW</span>
  }

  const modes = [
    { key: 'all',        label: 'All Terms',    icon: '⊞' },
    { key: 'wasted',     label: 'Wasted Spend', icon: '🗑' },
    { key: 'converters', label: 'Converters',   icon: '⭐' },
  ]

  const buildUrl = (params: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = {
      profile_id: String(profileId),
      days:       isAllTime ? 'all' : String(days),
      mode,
      min_spend:  String(minSpend),
      adType:     adType !== 'all' ? adType : undefined,
      start:      searchParams.start,
      end:        searchParams.end,
      ...params,
    }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
    return `/dashboard/search-terms?${qs}`
  }

  const adTypeCls: Record<string, string> = {
    SP: 'bg-blue-50 text-blue-600',
    SB: 'bg-purple-50 text-purple-600',
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Search Terms</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {terms.length} terms · {sortedGroups.length} campaign{sortedGroups.length !== 1 ? 's' : ''} · {isAllTime ? 'All time' : isCustom ? `${startStr} – ${endStr}` : `${days}d`} · {adType === 'all' ? 'SP + SB' : adType}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Mode filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {modes.map(m => (
              <Link key={m.key} href={buildUrl({ mode: m.key })}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  mode === m.key ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span>{m.icon}</span>{m.label}
              </Link>
            ))}
          </div>
          {/* Ad type filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {(['all', 'SP', 'SB'] as const).map(t => (
              <Link key={t} href={buildUrl({ adType: t === 'all' ? undefined : t })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  adType === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{t === 'all' ? 'All' : t}</Link>
            ))}
          </div>
          {/* Day range */}
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {[7, 14, 30, 60].map(d => (
              <Link key={d} href={buildUrl({ days: String(d), start: undefined, end: undefined })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  !isCustom && !isAllTime && days === d ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >{d}d</Link>
            ))}
            <Link href={buildUrl({ days: 'all', start: undefined, end: undefined })}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                isAllTime ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'
              }`}
            >All</Link>
          </div>
          {/* Custom date range */}
          <Suspense fallback={null}>
            <DateRangePicker start={startStr} end={endStr} basePath="/dashboard/search-terms" />
          </Suspense>
        </div>
      </div>

      {/* Wasted spend banner */}
      {totalWaste !== null && totalWaste > 0 && (
        <div className="flex items-center gap-4 bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0 text-lg">💸</div>
          <div>
            <p className="font-bold text-red-800 text-sm">${totalWaste.toFixed(2)} wasted {isAllTime ? 'all time' : isCustom ? `${startStr} – ${endStr}` : `over ${days} days`}</p>
            <p className="text-xs text-red-600 mt-0.5">
              {terms.length} term{terms.length !== 1 ? 's' : ''} with &gt;${minSpend} spend and zero sales.
              {wastedKwCount > 0 && <> <span className="font-semibold">{wastedKwCount} KW</span> → add as negative keywords.</>}
              {wastedAsinCount > 0 && <> <span className="font-semibold">{wastedAsinCount} ASIN/Auto</span> → add as negative product targets.</>}
            </p>
          </div>
        </div>
      )}

      {/* Converters banner */}
      {mode === 'converters' && terms.length > 0 && (
        <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0 text-lg">⭐</div>
          <div>
            <p className="font-bold text-emerald-800 text-sm">{terms.length} high-converting search terms</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              ACOS ≤ 15% with 2+ orders. Move these to Exact Match campaigns for better control.
            </p>
          </div>
        </div>
      )}

      {/* Table with campaign filter */}
      <SearchTermsTable
        sortedGroups={sortedGroups as any}
        campaigns={allCampaigns}
        mode={mode}
        colCount={colCount}
        minSpend={minSpend}
      />

      {/* OLD TABLE REMOVED — now in SearchTermsTable client component */}
      {false && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
                {mode === 'wasted' && (
                  <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedGroups.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-5 py-16 text-center text-sm text-gray-400">
                    {mode === 'wasted'      ? `No search terms with >$${minSpend} spend and zero sales.` :
                     mode === 'converters'  ? 'No converting terms with ACOS ≤ 15% and 2+ orders.' :
                                             'No search term data for this period.'}
                  </td>
                </tr>
              ) : sortedGroups.map(([campaignName, groupTerms]) => (
                <>
                  {/* Campaign section header */}
                  <tr key={`h-${campaignName}`} className="bg-gray-50 border-y border-gray-100 first:border-t-0">
                    <td colSpan={colCount} className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide truncate">{campaignName}</span>
                        <span className="text-[10px] text-gray-400 shrink-0 bg-gray-200 rounded px-1.5 py-0.5">
                          {groupTerms.length}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {/* Term rows */}
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
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${adTypeCls[t.adType] ?? ''}`}>
                            {t.adType}
                          </span>
                          {termTypeBadge(t.matchType)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">${t.spend.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">${t.sales.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        {t.acos !== null ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg border ${
                            t.acos < 25 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            t.acos < 50 ? 'bg-amber-50 text-amber-700 border-amber-200'       :
                                          'bg-red-50 text-red-600 border-red-200'
                          }`}>{t.acos}%</span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{t.orders}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{t.clicks}</td>
                      <td className="px-4 py-3 text-right text-gray-400 tabular-nums">
                        {t.cvr !== null ? `${t.cvr}%` : <span className="text-gray-300">—</span>}
                      </td>
                      {mode === 'wasted' && (
                        <td className="px-5 py-3 text-right">
                          {isAsinType(t.matchType) ? (
                            <span title="Add as Negative Product Target (ASIN/category, not a keyword)" className="text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-teal-100 transition-colors">
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
      </div>}

    </div>
  )
}
