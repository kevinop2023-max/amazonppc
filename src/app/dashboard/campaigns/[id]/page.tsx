import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import CampaignPerformanceChart, { type DailyPoint, type ChangeMarker } from '@/components/CampaignPerformanceChart'
import CampaignDetailTabs, { type AdGroupRow, type PlacementRow } from '@/components/CampaignDetailTabs'
import { type ChangeEvent } from '@/components/ChangesView'

export const revalidate = 0

function dateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

const TABLE: Record<string, string> = { SP: 'sp_campaigns', SB: 'sb_campaigns', SD: 'sd_campaigns' }

const FIELD_LABEL: Record<string, string> = {
  BID_AMOUNT: 'Keyword bid', DEFAULT_BID_AMOUNT: 'Ad group bid', BUDGET_AMOUNT: 'Budget',
  PLACEMENT_TOP: 'Top-of-search', PLACEMENT_PRODUCT_PAGE: 'Product-page', PLACEMENT_REST_OF_SEARCH: 'Rest-of-search',
  SMART_BIDDING_STRATEGY: 'Bid strategy', STATUS: 'Status', IN_BUDGET: 'In-budget',
}
const isCents = (f: string) => ['BID_AMOUNT', 'DEFAULT_BID_AMOUNT', 'BUDGET_AMOUNT'].includes(f)
const isPct   = (f: string) => f.startsWith('PLACEMENT_')

function markerLabel(e: any): string {
  const lbl = FIELD_LABEL[e.field] ?? e.field
  if (isCents(e.field)) return `${lbl} $${(Number(e.old_value) / 100).toFixed(2)}→$${(Number(e.new_value) / 100).toFixed(2)}`
  if (isPct(e.field))   return `${lbl} ${e.old_value}%→${e.new_value}%`
  return `${lbl} ${e.old_text ?? '—'}→${e.new_text ?? '—'}`
}

export default async function CampaignDetailPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { profile_id?: string; type?: string; days?: string; start?: string; end?: string }
}) {
  const supabase = await createClient()
  const campaignId = params.id
  const adType = (searchParams.type ?? 'SP').toUpperCase()
  const table = TABLE[adType] ?? 'sp_campaigns'

  const { data: profiles } = await supabase.from('amazon_profiles').select('profile_id, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null

  const isAllTime = searchParams.days === 'all'
  const days = isAllTime ? 0 : Number(searchParams.days ?? 30)
  const isCustom = !!(searchParams.start && searchParams.end)
  const startStr = searchParams.start ?? (isAllTime ? '2020-01-01' : dateStr(days))
  const endStr   = searchParams.end ?? dateStr(1)

  if (!profileId) return <p className="text-sm text-gray-500 p-6">No Amazon account connected.</p>

  const metaCols = adType === 'SP'
    ? 'date, campaign_name, state, daily_budget_cents, bidding_strategy, placement_top_pct, placement_product_pct, placement_rest_pct, spend_cents, sales_cents, orders, clicks, impressions'
    : 'date, campaign_name, state, daily_budget_cents, spend_cents, sales_cents, orders, clicks, impressions'

  const noData = Promise.resolve({ data: [] as any[] })
  const [{ data: rows }, { data: chgRaw }, { data: agRows }, { data: kbh }, { data: agPerf }, { data: placePerf }] = await Promise.all([
    supabase.from(table).select(metaCols).eq('profile_id', profileId).eq('campaign_id', campaignId).order('date', { ascending: false }).range(0, 49999),
    supabase.from('change_events').select('id, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, ad_type, source').eq('profile_id', profileId).eq('campaign_id', campaignId).order('event_ts', { ascending: false }).range(0, 49999),
    adType === 'SP' ? supabase.from('sp_ad_groups').select('ad_group_id, ad_group_name, state, default_bid_cents, date').eq('profile_id', profileId).eq('campaign_id', campaignId).order('date', { ascending: false }).range(0, 49999) : noData,
    supabase.from('keyword_bid_history').select('keyword_id, keyword_text, match_type').eq('profile_id', profileId).range(0, 49999),
    adType === 'SP' ? supabase.from('ad_group_performance').select('ad_group_id, spend_cents, sales_cents, orders, clicks').eq('profile_id', profileId).eq('campaign_id', campaignId).gte('date', startStr).lte('date', endStr).range(0, 49999) : noData,
    adType === 'SP' ? supabase.from('placement_performance').select('placement, spend_cents, sales_cents, orders, clicks').eq('profile_id', profileId).eq('campaign_id', campaignId).gte('date', startStr).lte('date', endStr).range(0, 49999) : noData,
  ])

  const all = (rows ?? []) as any[]
  if (!all.length) return (
    <div className="p-6">
      <Link href={`/dashboard/campaigns?profile_id=${profileId}`} className="text-sm text-orange-600">← Campaigns</Link>
      <p className="text-sm text-gray-500 mt-4">Campaign not found.</p>
    </div>
  )

  const meta = all[0]  // most recent row
  const name = meta.campaign_name as string

  // Daily performance within range (ascending for the chart)
  const inRange = all.filter(r => r.date >= startStr && r.date <= endStr).sort((a, b) => a.date.localeCompare(b.date))
  const daily: DailyPoint[] = inRange.map(r => ({ date: r.date, spendCents: r.spend_cents ?? 0, salesCents: r.sales_cents ?? 0, clicks: r.clicks ?? 0, orders: r.orders ?? 0 }))

  // KPIs
  const sum = inRange.reduce((s, r) => ({
    spend: s.spend + (r.spend_cents ?? 0), sales: s.sales + (r.sales_cents ?? 0),
    orders: s.orders + (r.orders ?? 0), clicks: s.clicks + (r.clicks ?? 0), impressions: s.impressions + (r.impressions ?? 0),
  }), { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 })
  const acos = sum.sales > 0 ? (sum.spend / sum.sales * 100).toFixed(1) + '%' : '—'
  const roas = sum.spend > 0 ? (sum.sales / sum.spend).toFixed(2) + 'x' : '—'
  const cpc  = sum.clicks > 0 ? '$' + (sum.spend / sum.clicks / 100).toFixed(2) : '—'

  // Name resolution for change events
  const kwName = new Map<string, string>()
  for (const k of kbh ?? []) { const key = String(k.keyword_id); if (!kwName.has(key)) kwName.set(key, k.match_type ? `${k.keyword_text} (${k.match_type})` : k.keyword_text) }
  const agNameMap = new Map<string, string>()
  for (const a of agRows ?? []) { const key = String(a.ad_group_id); if (!agNameMap.has(key) && a.ad_group_name) agNameMap.set(key, a.ad_group_name) }
  const nameFor = (e: any) => e.entity_type === 'CAMPAIGN' ? name
    : (e.entity_type === 'KEYWORD' || e.entity_type === 'PRODUCT_TARGETING') ? (kwName.get(e.entity_id) ?? `${e.entity_type === 'KEYWORD' ? 'Keyword' : 'Target'} ${e.entity_id}`)
    : e.entity_type === 'AD_GROUP' ? (agNameMap.get(e.entity_id) ?? `Ad group ${e.entity_id}`)
    : `${e.entity_type} ${e.entity_id}`

  const chg = (chgRaw ?? []) as any[]
  const changeEvents: ChangeEvent[] = chg.map(e => ({
    id: e.id, entity_type: e.entity_type, entity_id: e.entity_id, campaign_id: e.campaign_id, field: e.field,
    old_value: e.old_value == null ? null : Number(e.old_value), new_value: e.new_value == null ? null : Number(e.new_value),
    old_text: e.old_text, new_text: e.new_text, event_ts: e.event_ts, ad_type: e.ad_type, source: e.source,
    entityName: nameFor(e), campaignName: name,
  }))

  // Chart markers — changes whose date falls in the visible range
  const markerMap = new Map<string, string[]>()
  for (const e of chg) {
    const d = String(e.event_ts).slice(0, 10)
    if (d < startStr || d > endStr) continue
    if (!markerMap.has(d)) markerMap.set(d, [])
    markerMap.get(d)!.push(markerLabel(e))
  }
  const markers: ChangeMarker[] = [...markerMap.entries()].map(([date, labels]) => ({ date, labels }))

  // Performance aggregation (within range)
  type Perf = { spend_cents: number; sales_cents: number; orders: number; clicks: number }
  const zero = (): Perf => ({ spend_cents: 0, sales_cents: 0, orders: 0, clicks: 0 })
  const agPerfMap = new Map<string, Perf>()
  for (const r of agPerf ?? []) { const k = String(r.ad_group_id); const p = agPerfMap.get(k) ?? zero(); p.spend_cents += r.spend_cents ?? 0; p.sales_cents += r.sales_cents ?? 0; p.orders += r.orders ?? 0; p.clicks += r.clicks ?? 0; agPerfMap.set(k, p) }

  const placeKey = (txt: string) => { const t = (txt ?? '').toLowerCase(); return t.includes('top') ? 'PLACEMENT_TOP' : (t.includes('detail') || t.includes('product')) ? 'PLACEMENT_PRODUCT_PAGE' : 'PLACEMENT_REST_OF_SEARCH' }
  const placePerfMap = new Map<string, Perf>()
  for (const r of placePerf ?? []) { const k = placeKey(r.placement); const p = placePerfMap.get(k) ?? zero(); p.spend_cents += r.spend_cents ?? 0; p.sales_cents += r.sales_cents ?? 0; p.orders += r.orders ?? 0; p.clicks += r.clicks ?? 0; placePerfMap.set(k, p) }

  // Ad groups (most recent per ad_group) + their bid-change events + perf
  const agMeta = new Map<string, AdGroupRow>()
  for (const a of agRows ?? []) {
    const key = String(a.ad_group_id)
    if (!agMeta.has(key)) agMeta.set(key, { ad_group_id: key, name: a.ad_group_name ?? `Ad group ${key}`, state: (a.state ?? 'enabled').toLowerCase(), default_bid_cents: a.default_bid_cents ?? 0, bidEvents: [], ...zero() })
  }
  for (const e of chg) if (e.entity_type === 'AD_GROUP' && e.field === 'DEFAULT_BID_AMOUNT') {
    const r = agMeta.get(String(e.entity_id)); if (r) r.bidEvents.push({ ts: e.event_ts, old_value: Number(e.old_value), new_value: Number(e.new_value) })
  }
  for (const [k, r] of agMeta) { const p = agPerfMap.get(k); if (p) Object.assign(r, p) }
  const adGroups = [...agMeta.values()].sort((a, b) => b.spend_cents - a.spend_cents || a.name.localeCompare(b.name))

  // Placements (SP)
  const placements: PlacementRow[] = adType === 'SP' ? [
    { key: 'PLACEMENT_TOP', label: 'Top of search', current: Number(meta.placement_top_pct ?? 0), events: [], ...zero() },
    { key: 'PLACEMENT_PRODUCT_PAGE', label: 'Product pages', current: Number(meta.placement_product_pct ?? 0), events: [], ...zero() },
    { key: 'PLACEMENT_REST_OF_SEARCH', label: 'Rest of search', current: Number(meta.placement_rest_pct ?? 0), events: [], ...zero() },
  ] : []
  for (const e of chg) { const p = placements.find(x => x.key === e.field); if (p) p.events.push({ ts: e.event_ts, old_value: Number(e.old_value), new_value: Number(e.new_value) }) }
  for (const p of placements) { const pf = placePerfMap.get(p.key); if (pf) Object.assign(p, pf) }

  // Strategy (SP)
  const stratChanges = chg.filter(e => e.field === 'SMART_BIDDING_STRATEGY').map(e => ({ ts: e.event_ts, from: e.old_text, to: e.new_text }))
  const strategy = { current: adType === 'SP' ? (meta.bidding_strategy ?? null) : null, changes: stratChanges }

  const rangeLabel = isAllTime ? 'All time' : isCustom ? `${startStr} – ${endStr}` : `Last ${days} days`
  const dayLink = (d: string) => `/dashboard/campaigns/${campaignId}?profile_id=${profileId}&type=${adType}&days=${d}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href={`/dashboard/campaigns?profile_id=${profileId}`} className="text-xs text-gray-400 hover:text-orange-600">← All campaigns</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${adType === 'SP' ? 'bg-blue-50 text-blue-600' : adType === 'SB' ? 'bg-purple-50 text-purple-600' : 'bg-teal-50 text-teal-600'}`}>{adType}</span>
            <h1 className="text-xl font-bold text-gray-900 truncate">{name}</h1>
            {meta.state && meta.state.toLowerCase() !== 'enabled' && <span className="text-xs text-gray-400">({meta.state})</span>}
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {['7', '14', '30', '60'].map(d => (
              <Link key={d} href={dayLink(d)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${!isCustom && !isAllTime && days === Number(d) ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>{d}d</Link>
            ))}
            <Link href={dayLink('all')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${isAllTime ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>All</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
          <span>Budget: <span className="font-semibold text-gray-700">${((meta.daily_budget_cents ?? 0) / 100).toFixed(2)}/day</span></span>
          {adType === 'SP' && meta.bidding_strategy && <span>Strategy: <span className="font-semibold text-gray-700">{meta.bidding_strategy}</span></span>}
          <span>{rangeLabel}</span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: 'Spend', value: '$' + (sum.spend / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
          { label: 'Sales', value: '$' + (sum.sales / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
          { label: 'ACOS', value: acos },
          { label: 'ROAS', value: roas },
          { label: 'Orders', value: sum.orders.toLocaleString() },
          { label: 'CPC', value: cpc },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5 text-center">
            <div className="text-lg font-bold text-gray-900 tabular-nums">{k.value}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Performance chart with change markers */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Performance &amp; changes</h2>
        <CampaignPerformanceChart daily={daily} markers={markers} />
      </div>

      {/* Tabs */}
      <CampaignDetailTabs adType={adType} adGroups={adGroups} placements={placements} strategy={strategy} changeEvents={changeEvents} />
    </div>
  )
}
