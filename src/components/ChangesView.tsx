'use client'

import { useMemo, useState } from 'react'
import ChangeHistoryChart, { fmtValue } from './ChangeHistoryChart'

export type ChangeEvent = {
  id: number
  entity_type: string
  entity_id: string
  campaign_id: string | null
  field: string
  old_value: number | null
  new_value: number | null
  old_text: string | null
  new_text: string | null
  event_ts: string
  ad_type: string | null
  source: string
  entityName: string
  campaignName: string | null
  metadata?: Record<string, any> | null
}

type Meta = { label: string; group: string; kind: 'cents' | 'percent' | 'text'; chip: string; dot: string }

const FIELD_META: Record<string, Meta> = {
  BID_AMOUNT:               { label: 'Bid',           group: 'bids',       kind: 'cents',   chip: 'bg-blue-50 text-blue-700',     dot: '#2563eb' },
  DEFAULT_BID_AMOUNT:       { label: 'Ad group bid',  group: 'bids',       kind: 'cents',   chip: 'bg-blue-50 text-blue-700',     dot: '#2563eb' },
  BUDGET_AMOUNT:            { label: 'Budget',        group: 'budgets',    kind: 'cents',   chip: 'bg-orange-50 text-orange-700', dot: '#ea580c' },
  PLACEMENT_TOP:            { label: 'Top of search', group: 'placements', kind: 'percent', chip: 'bg-teal-50 text-teal-700',     dot: '#0d9488' },
  PLACEMENT_PRODUCT_PAGE:   { label: 'Product pages', group: 'placements', kind: 'percent', chip: 'bg-teal-50 text-teal-700',     dot: '#0d9488' },
  PLACEMENT_REST_OF_SEARCH: { label: 'Rest of search',group: 'placements', kind: 'percent', chip: 'bg-teal-50 text-teal-700',     dot: '#0d9488' },
  PLACEMENT_GROUP:          { label: 'Placement',     group: 'placements', kind: 'percent', chip: 'bg-teal-50 text-teal-700',     dot: '#0d9488' },
  CREATED:                  { label: 'Created',       group: 'status',     kind: 'text',    chip: 'bg-emerald-50 text-emerald-700', dot: '#059669' },
  SMART_BIDDING_STRATEGY:   { label: 'Bid strategy',  group: 'strategy',   kind: 'text',    chip: 'bg-purple-50 text-purple-700', dot: '#9333ea' },
  STATUS:                   { label: 'Status',        group: 'status',     kind: 'text',    chip: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
  IN_BUDGET:                { label: 'In budget',     group: 'status',     kind: 'text',    chip: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
  NAME:                     { label: 'Name',          group: 'status',     kind: 'text',    chip: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
  START_DATE:               { label: 'Start date',    group: 'status',     kind: 'text',    chip: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
  END_DATE:                 { label: 'End date',      group: 'status',     kind: 'text',    chip: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
  PORTFOLIO:                { label: 'Portfolio',     group: 'status',     kind: 'text',    chip: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
}
const meta = (field: string): Meta => FIELD_META[field] ?? { label: field, group: 'other', kind: 'text', chip: 'bg-gray-100 text-gray-600', dot: '#6b7280' }

// Change History API reports all placement multipliers as field=PLACEMENT_GROUP, with the
// specific placement in metadata.placementGroupPosition — resolve it into the label.
const PLACEMENT_POSITION_LABEL: Record<string, string> = {
  TOP: 'Top of search', REST_OF_SEARCH: 'Rest of search', DETAIL_PAGE: 'Product pages',
  PRODUCT_PAGE: 'Product pages', HOME: 'Home page', OTHER: 'Other placements',
}
const metaFor = (e: { field: string; metadata?: Record<string, any> | null }): Meta => {
  const m = meta(e.field)
  if (e.field !== 'PLACEMENT_GROUP') return m
  const pos = e.metadata?.placementGroupPosition
  return pos ? { ...m, label: PLACEMENT_POSITION_LABEL[pos] ?? String(pos) } : m
}

const ENTITY_LABEL: Record<string, string> = {
  CAMPAIGN: 'Campaign', AD_GROUP: 'Ad group', KEYWORD: 'Keyword', PRODUCT_TARGETING: 'Target', NEGATIVE_KEYWORD: 'Neg KW', AD: 'Ad',
}

const GROUPS = [
  { key: 'all',        label: 'All' },
  { key: 'bids',       label: 'Bids' },
  { key: 'budgets',    label: 'Budgets' },
  { key: 'placements', label: 'Placements' },
  { key: 'strategy',   label: 'Strategy' },
  { key: 'status',     label: 'Status' },
] as const

function fmtDateTime(s: string) {
  const d = new Date(s)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  return midnight ? date : `${date} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function ChangeValue({ e }: { e: ChangeEvent }) {
  const m = metaFor(e)
  if (m.kind === 'text') {
    return (
      <span className="tabular-nums">
        <span className="text-gray-400">{e.old_text ?? '—'}</span>
        <span className="text-gray-300 mx-1.5">→</span>
        <span className="font-semibold text-gray-900">{e.new_text ?? '—'}</span>
      </span>
    )
  }
  const up = (e.new_value ?? 0) > (e.old_value ?? 0)
  return (
    <span className="tabular-nums">
      <span className="text-gray-400">{fmtValue(e.old_value, m.kind)}</span>
      <span className="text-gray-300 mx-1.5">→</span>
      <span className={`font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>{fmtValue(e.new_value, m.kind)}</span>
      <span className={`ml-1 text-[10px] ${up ? 'text-emerald-500' : 'text-red-500'}`}>{up ? '▲' : '▼'}</span>
    </span>
  )
}

export default function ChangesView({ events, source }: { events: ChangeEvent[]; source: 'api' | 'snapshot' | 'mixed' }) {
  const [group, setGroup] = useState<string>('all')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'timeline' | 'charts'>('timeline')

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) { const g = meta(e.field).group; c[g] = (c[g] ?? 0) + 1 }
    return c
  }, [events])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return events.filter(e =>
      (group === 'all' || meta(e.field).group === group) &&
      (!ql || e.entityName.toLowerCase().includes(ql) || (e.campaignName ?? '').toLowerCase().includes(ql))
    )
  }, [events, group, q])

  // Build per-entity+field numeric series for the Charts view
  const series = useMemo(() => {
    const map = new Map<string, { key: string; e0: ChangeEvent; events: ChangeEvent[] }>()
    for (const e of filtered) {
      if (meta(e.field).kind === 'text') continue
      // Placement multipliers share field=PLACEMENT_GROUP — split series by position so
      // Top-of-search and Rest-of-search don't merge into one chart.
      const pos = e.field === 'PLACEMENT_GROUP' ? `|${e.metadata?.placementGroupPosition ?? ''}` : ''
      const k = `${e.entity_type}|${e.entity_id}|${e.field}${pos}`
      if (!map.has(k)) map.set(k, { key: k, e0: e, events: [] })
      map.get(k)!.events.push(e)
    }
    return [...map.values()].sort((a, b) => b.events.length - a.events.length)
  }, [filtered])

  const entitiesChanged = useMemo(() => new Set(events.map(e => `${e.entity_type}|${e.entity_id}`)).size, [events])

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total changes',    value: events.length },
          { label: 'Entities changed', value: entitiesChanged },
          { label: 'Bid changes',      value: (counts.bids ?? 0) },
          { label: 'Budget changes',   value: (counts.budgets ?? 0) },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{c.value.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
          {GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${group === g.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
              {g.label}{g.key !== 'all' && counts[g.key] ? <span className="ml-1 opacity-60">{counts[g.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search entity / campaign…"
            className="px-3 py-2 text-xs border border-gray-200 rounded-xl w-56 focus:outline-none focus:ring-2 focus:ring-orange-200" />
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
            {(['timeline', 'charts'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all ${view === v ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {events.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <p className="text-sm text-gray-500">No change history captured yet.</p>
          <p className="text-xs text-gray-400 mt-1">Bid, budget, status, placement and strategy changes appear here as they are detected on each sync.</p>
        </div>
      )}

      {/* Timeline */}
      {events.length > 0 && view === 'timeline' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Entity</th>
                <th className="px-4 py-2.5 font-medium">What changed</th>
                <th className="px-4 py-2.5 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const m = metaFor(e)
                return (
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(e.event_ts)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{ENTITY_LABEL[e.entity_type] ?? e.entity_type}</span>
                        <span className="font-medium text-gray-900 truncate max-w-[260px]" title={e.entityName}>{e.entityName}</span>
                      </div>
                      {e.campaignName && e.entity_type !== 'CAMPAIGN' && (
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[300px]">{e.campaignName}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.chip}`}>{m.label}</span>
                    </td>
                    <td className="px-4 py-2.5"><ChangeValue e={e} /></td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No changes match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Charts */}
      {events.length > 0 && view === 'charts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {series.map(s => {
            const m = metaFor(s.e0)
            const latest = [...s.events].sort((a, b) => b.event_ts.localeCompare(a.event_ts))[0]
            return (
              <div key={s.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{ENTITY_LABEL[s.e0.entity_type] ?? s.e0.entity_type}</span>
                      <span className="font-semibold text-gray-900 text-sm truncate" title={s.e0.entityName}>{s.e0.entityName}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      <span className={`font-medium px-1.5 py-0.5 rounded-full ${m.chip}`}>{m.label}</span>
                      <span className="ml-2">{s.events.length} change{s.events.length > 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-gray-900 tabular-nums">{fmtValue(latest.new_value, m.kind as 'cents' | 'percent')}</div>
                    <div className="text-[10px] text-gray-400">current</div>
                  </div>
                </div>
                <ChangeHistoryChart
                  events={s.events.map(ev => ({ ts: ev.event_ts, old_value: ev.old_value, new_value: ev.new_value }))}
                  kind={m.kind as 'cents' | 'percent'} color={m.dot} />
              </div>
            )
          })}
          {series.length === 0 && (
            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-sm text-gray-400">
              No numeric trends for this filter. Try “Bids”, “Budgets”, or “Placements”.
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Source: {source === 'snapshot' ? 'snapshot-diff (date-level)' : source === 'api' ? 'Amazon Change History API' : 'mixed'} ·
        {' '}Snapshot-derived changes are dated to the day detected.
      </p>
    </div>
  )
}
