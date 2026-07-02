'use client'
import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import ChangeHistoryChart from '@/components/ChangeHistoryChart'
import { CampaignGroup, TargetItem, TermItem, ChangeChip, AB } from './types'
import { fmtD, acosPct, pctChg, fmtDate } from './ab'

// ── Small display helpers ──────────────────────────────────────────────────────

function matchBadge(mt: string | null | undefined) {
  if (!mt) return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-50 text-teal-700">ASIN</span>
  const m = mt.toLowerCase()
  const cls =
    m === 'exact'   ? 'bg-blue-50 text-blue-700' :
    m === 'phrase'  ? 'bg-purple-50 text-purple-700' :
    m === 'broad'   ? 'bg-gray-100 text-gray-600' :
    m === 'theme'   ? 'bg-violet-50 text-violet-700' :
    ['close-match', 'loose-match', 'substitutes', 'complements'].includes(m) ? 'bg-amber-50 text-amber-700' :
    m.startsWith('targeting_expression') ? 'bg-teal-50 text-teal-700' :
    'bg-gray-100 text-gray-500'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${cls}`}>{mt}</span>
}

function targetLabel(mt: string, text: string) {
  const m = (mt ?? '').toLowerCase()
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

const STRATEGY_LABEL: Record<string, string> = {
  LEGACY_FOR_SALES: 'Down only', AUTO_FOR_SALES: 'Up & down', MANUAL: 'Fixed bids',
  LEGACY: 'Down only', AUTO: 'Up & down', RULE_BASED: 'Rule-based',
}

function DeltaBadge({ value, unit = 'pct', lowerIsBetter = false }: { value: number | null; unit?: 'pp' | 'pct'; lowerIsBetter?: boolean }) {
  if (value === null) return <span className="text-[10px] text-gray-300">—</span>
  const abs = Math.abs(value)
  if (abs < 0.1) return <span className="text-[10px] text-gray-400">±0</span>
  const str = `${value >= 0 ? '+' : ''}${value.toFixed(1)}${unit === 'pp' ? 'pp' : '%'}`
  const good = lowerIsBetter ? value < 0 : value > 0
  const cls = abs < 1 ? 'text-gray-400' : good ? 'text-emerald-600' : 'text-red-500'
  return <span className={`text-[10px] font-semibold ${cls}`}>{str}</span>
}

// One metric cell: "A → B" with the delta beneath
function ABCell({ a, b, money = false, deltaLowerIsBetter }: { a: number; b: number; money?: boolean; deltaLowerIsBetter?: boolean }) {
  const f = (v: number) => money ? fmtD(v) : v.toLocaleString()
  return (
    <div className="tabular-nums leading-tight">
      <div className="whitespace-nowrap">
        <span className="text-gray-400 text-[11px]">{f(a)}</span>
        <span className="text-gray-300 mx-1 text-[10px]">→</span>
        <span className="text-gray-900 text-xs font-semibold">{f(b)}</span>
      </div>
      {deltaLowerIsBetter !== undefined && <DeltaBadge value={pctChg(a, b)} lowerIsBetter={deltaLowerIsBetter} />}
    </div>
  )
}

function AcosABCell({ ab }: { ab: AB }) {
  const a = acosPct(ab.aSpend, ab.aSales), b = acosPct(ab.bSpend, ab.bSales)
  const f = (v: number | null) => v === null ? '—' : v.toFixed(1) + '%'
  const color = (v: number | null) => v === null ? 'text-gray-300' : v > 50 ? 'text-red-600' : v < 25 ? 'text-emerald-600' : 'text-amber-600'
  return (
    <div className="tabular-nums leading-tight">
      <div className="whitespace-nowrap">
        <span className={`text-[11px] ${color(a)} opacity-60`}>{f(a)}</span>
        <span className="text-gray-300 mx-1 text-[10px]">→</span>
        <span className={`text-xs font-semibold ${color(b)}`}>{f(b)}</span>
      </div>
      <DeltaBadge value={a !== null && b !== null ? b - a : null} unit="pp" lowerIsBetter />
    </div>
  )
}

function BidCell({ prev, cur }: { prev: number | null; cur: number }) {
  if (prev == null || prev === cur) return <span className="text-xs tabular-nums text-gray-700">{fmtD(cur)}</span>
  return (
    <span className="text-xs tabular-nums whitespace-nowrap">
      <span className="text-gray-400">{fmtD(prev)}</span>
      <span className="text-gray-300 mx-1">→</span>
      <span className={cur > prev ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{fmtD(cur)}</span>
    </span>
  )
}

function ChipButton({ chip, anchored, onAnchor }: { chip: ChangeChip; anchored: boolean; onAnchor: (c: ChangeChip) => void }) {
  const color = chip.field === 'BID_AMOUNT' ? 'bg-blue-50 text-blue-700 border-blue-100 hover:border-blue-300'
    : chip.field.startsWith('PLACEMENT') ? 'bg-teal-50 text-teal-700 border-teal-100 hover:border-teal-300'
    : chip.field === 'SMART_BIDDING_STRATEGY' ? 'bg-purple-50 text-purple-700 border-purple-100 hover:border-purple-300'
    : 'bg-orange-50 text-orange-700 border-orange-100 hover:border-orange-300'
  return (
    <button onClick={() => onAnchor(chip)} title="Set A/B to before vs after this change"
      className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all whitespace-nowrap ${color} ${anchored ? 'ring-2 ring-orange-400' : ''}`}>
      {chip.label}
    </button>
  )
}

// ── Sub-tables ────────────────────────────────────────────────────────────────

const ST_COLS = 8

function TermRows({ terms, omitted }: { terms: TermItem[]; omitted: number }) {
  if (!terms.length) return <tr><td colSpan={ST_COLS} className="px-4 py-3 text-[11px] text-gray-400">No search terms in these periods.</td></tr>
  return (
    <>
      {terms.map((t, i) => {
        const cvrB = t.bClicks > 0 ? (t.bOrders / t.bClicks * 100).toFixed(1) + '%' : '—'
        return (
          <tr key={i} className="border-b border-gray-50 last:border-0">
            <td className="px-4 py-1.5 text-[11px] text-gray-700 max-w-[260px] truncate" title={t.term}>
              {t.placeholder
                ? <span className="italic text-gray-400">{t.term} <span className="text-[9px]">(query hidden by Amazon)</span></span>
                : t.term}
            </td>
            <td className="px-2 py-1.5"><TermTypeBadge mt={t.matchType} /></td>
            <td className="px-2 py-1.5"><ABCell a={t.aSpend} b={t.bSpend} money /></td>
            <td className="px-2 py-1.5"><ABCell a={t.aSales} b={t.bSales} money /></td>
            <td className="px-2 py-1.5"><AcosABCell ab={t} /></td>
            <td className="px-2 py-1.5"><ABCell a={t.aOrders} b={t.bOrders} /></td>
            <td className="px-2 py-1.5"><ABCell a={t.aClicks} b={t.bClicks} /></td>
            <td className="px-2 py-1.5 text-[11px] tabular-nums text-gray-500">{cvrB}</td>
          </tr>
        )
      })}
      {omitted > 0 && <tr><td colSpan={ST_COLS} className="px-4 py-1.5 text-[10px] text-gray-400">+{omitted} more terms (lower spend) not shown</td></tr>}
    </>
  )
}

function TermTypeBadge({ mt }: { mt: string | null }) {
  if (!mt) return null
  const m = mt.toLowerCase()
  if (m.startsWith('targeting_expression') || m === 'substitutes' || m === 'complements')
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">ASIN</span>
  if (m === 'close-match' || m === 'loose-match')
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">AUTO</span>
  if (m === 'theme')
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">THEME</span>
  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">KW</span>
}

// Bid history chart with real change-event markers
function BidChart({ target }: { target: TargetItem }) {
  const data = target.bidHistory.map(h => ({ date: h.date, bid: h.bidCents / 100 }))
  // Snap each real change event to the nearest recorded history date so ReferenceLine lands
  // on the axis. Events BEFORE the history window are dropped (they'd all pile up on the
  // first date) — the campaign change-chips row still shows them.
  const markers = useMemo(() => {
    const dates = data.map(d => d.date)
    const first = dates[0]
    return target.bidEvents
      .filter(ev => ev.ts.slice(0, 10) >= first)
      .map(ev => {
        const d = ev.ts.slice(0, 10)
        const snapped = dates.find(x => x >= d) ?? dates[dates.length - 1]
        return { x: snapped, label: `${ev.old_value != null ? fmtD(ev.old_value) : ''}→${ev.new_value != null ? fmtD(ev.new_value) : ''}` }
      })
      .filter(m => m.x)
  }, [target, data])

  if (data.length < 2) {
    if (target.bidEvents.length >= 2)
      return <ChangeHistoryChart events={target.bidEvents} kind="cents" color="#f97316" height={110} />
    return <p className="text-[11px] text-gray-400 py-3">Not enough bid history yet.</p>
  }
  return (
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} />
          <YAxis tick={{ fontSize: 9 }} tickFormatter={v => '$' + v.toFixed(2)} width={44} domain={['auto', 'auto']} />
          <Tooltip formatter={(v: number) => ['$' + v.toFixed(2), 'Bid']} labelFormatter={l => 'Date: ' + l} />
          {markers.map((m, i) => (
            <ReferenceLine key={i} x={m.x} stroke="#f97316" strokeDasharray="4 3"
              label={{ value: m.label, position: 'top', fontSize: 8, fill: '#ea580c' }} />
          ))}
          <Line type="stepAfter" dataKey="bid" stroke="#2563eb" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

interface Props {
  group: CampaignGroup
  tab: string
  anchor: string | null
  defaultOpen: boolean
  onAnchor: (chip: ChangeChip) => void
}

export default function CampaignSection({ group: g, tab, anchor, defaultOpen, onAnchor }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null)
  const [expandedPlacement, setExpandedPlacement] = useState<string | null>(null)
  const [showUnattr, setShowUnattr] = useState(false)

  const targets = useMemo(
    () => tab === 'all' ? g.targets : g.targets.filter(t => t.targetType === tab),
    [g.targets, tab]
  )
  const aAcos = acosPct(g.aSpend, g.aSales), bAcos = acosPct(g.bSpend, g.bSales)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Campaign header */}
      <button onClick={() => setOpen(o => !o)} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-gray-50/60 transition-colors">
        <span className={`text-lg font-bold ${open ? 'text-orange-500' : 'text-gray-300'}`}>{open ? '▾' : '▸'}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${g.adType === 'SP' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{g.adType}</span>
        <span className="font-semibold text-gray-900 text-sm truncate max-w-[320px]" title={g.name}>{g.name}</span>
        {g.state !== 'enabled' && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{g.state}</span>}
        {g.outOfBudget && <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">Out of budget</span>}
        <span className="text-[11px] text-gray-400">{fmtD(g.budgetCents)}/day{g.strategy ? ` · ${STRATEGY_LABEL[g.strategy] ?? g.strategy}` : ''}</span>
        <span className="ml-auto flex items-center gap-4 tabular-nums">
          <span className="text-[11px] text-gray-500 whitespace-nowrap">Spend {fmtD(g.aSpend)}<span className="text-gray-300 mx-1">→</span><span className="font-semibold text-gray-800">{fmtD(g.bSpend)}</span></span>
          <span className="text-[11px] text-gray-500 whitespace-nowrap">Sales {fmtD(g.aSales)}<span className="text-gray-300 mx-1">→</span><span className="font-semibold text-gray-800">{fmtD(g.bSales)}</span></span>
          <span className="text-[11px] whitespace-nowrap">ACoS <span className="text-gray-400">{aAcos === null ? '—' : aAcos.toFixed(1) + '%'}</span><span className="text-gray-300 mx-1">→</span><span className="font-semibold text-gray-800">{bAcos === null ? '—' : bAcos.toFixed(1) + '%'}</span> <DeltaBadge value={aAcos !== null && bAcos !== null ? bAcos - aAcos : null} unit="pp" lowerIsBetter /></span>
          <span className="text-[11px] text-gray-500 whitespace-nowrap">Orders {g.aOrders}<span className="text-gray-300 mx-1">→</span><span className="font-semibold text-gray-800">{g.bOrders}</span></span>
          {g.changeCount > 0 && <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">{g.changeCount} changes</span>}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {/* Campaign-level chips: budget / strategy / SB placement changes only.
              Bid changes anchor from each target row; SP placement changes from their placement card. */}
          {g.changeChips.length > 0 && (
            <div className="px-4 py-2.5 bg-gray-50/50 border-b border-gray-100 flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mr-1">Campaign changes — click to compare before → after</span>
              {g.changeChips.map(c => (
                <ChipButton key={c.id} chip={c} anchored={anchor === String(c.id)} onAnchor={onAnchor} />
              ))}
            </div>
          )}

          {/* Placements (SP only) */}
          {g.adType === 'SP' && g.placements.length > 0 && (
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Placements — multiplier & A/B performance</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {g.placements.map(p => {
                  const pa = acosPct(p.aSpend, p.aSales), pb = acosPct(p.bSpend, p.bSales)
                  const expanded = expandedPlacement === p.key
                  return (
                    <div key={p.key} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">{p.label}</span>
                        <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md tabular-nums">{p.currentPct != null ? `+${p.currentPct}%` : '—'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px] tabular-nums">
                        <span className="text-gray-400">Spend</span><span>{fmtD(p.aSpend)} <span className="text-gray-300">→</span> <b>{fmtD(p.bSpend)}</b></span>
                        <span className="text-gray-400">Sales</span><span>{fmtD(p.aSales)} <span className="text-gray-300">→</span> <b>{fmtD(p.bSales)}</b></span>
                        <span className="text-gray-400">ACoS</span><span>{pa === null ? '—' : pa.toFixed(1) + '%'} <span className="text-gray-300">→</span> <b>{pb === null ? '—' : pb.toFixed(1) + '%'}</b> <DeltaBadge value={pa !== null && pb !== null ? pb - pa : null} unit="pp" lowerIsBetter /></span>
                        <span className="text-gray-400">Orders</span><span>{p.aOrders} <span className="text-gray-300">→</span> <b>{p.bOrders}</b></span>
                      </div>
                      {p.chips.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.chips.map(c => (
                            <ChipButton key={c.id} chip={c} anchored={anchor === String(c.id)} onAnchor={onAnchor} />
                          ))}
                        </div>
                      )}
                      {p.events.length > 1 && (
                        <button onClick={() => setExpandedPlacement(expanded ? null : p.key)} className="mt-2 text-[10px] font-medium text-teal-600 hover:text-teal-800">
                          {expanded ? '▾ hide' : '▸ show'} multiplier history
                        </button>
                      )}
                      {expanded && <div className="mt-1"><ChangeHistoryChart events={p.events} kind="percent" color="#0d9488" height={100} /></div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {g.adType === 'SB' && (
            <p className="px-4 py-2 text-[10px] text-gray-400 border-b border-gray-100">Placement performance breakdown is available for SP campaigns only (Amazon does not report it for SB). SB placement multiplier changes still appear as chips above.</p>
          )}

          {/* Targets table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-2 py-2 font-medium">Match</th>
                <th className="px-2 py-2 font-medium">Bid</th>
                {g.adType === 'SP' && <th className="px-2 py-2 font-medium">Top IS%</th>}
                <th className="px-2 py-2 font-medium">Spend A→B</th>
                <th className="px-2 py-2 font-medium">Sales A→B</th>
                <th className="px-2 py-2 font-medium">ACoS A→B</th>
                <th className="px-2 py-2 font-medium">Orders</th>
                <th className="px-2 py-2 font-medium">Clicks</th>
                <th className="px-2 py-2 font-medium">Last change</th>
              </tr>
            </thead>
            <tbody>
              {targets.map(t => {
                const key = `${t.adType}-${t.keywordId}`
                const expanded = expandedTarget === key
                const cols = g.adType === 'SP' ? 10 : 9
                return (
                  <TargetRowGroup key={key} t={t} expanded={expanded} cols={cols} showTopIs={g.adType === 'SP'}
                    anchor={anchor} onAnchor={onAnchor}
                    onToggle={() => setExpandedTarget(expanded ? null : key)} />
                )
              })}
              {targets.length === 0 && (
                <tr><td colSpan={g.adType === 'SP' ? 10 : 9} className="px-4 py-4 text-center text-xs text-gray-400">No targets in this tab.</td></tr>
              )}
              {/* Unattributed search terms bucket */}
              {g.unattributedTerms.length > 0 && tab === 'all' && (
                <>
                  <tr className="border-b border-gray-50 bg-gray-50/40 cursor-pointer hover:bg-gray-50" onClick={() => setShowUnattr(s => !s)}>
                    <td colSpan={g.adType === 'SP' ? 10 : 9} className="px-4 py-2 text-[11px] text-gray-500">
                      {showUnattr ? '▾' : '▸'} <span className="italic">Search terms not attributed to a target</span> · {g.unattributedTerms.length}
                      {g.omittedUnattributed > 0 && ` (+${g.omittedUnattributed} more)`}
                    </td>
                  </tr>
                  {showUnattr && (
                    <tr><td colSpan={g.adType === 'SP' ? 10 : 9} className="px-2 pb-2">
                      <div className="bg-gray-50/60 rounded-xl mx-2 overflow-hidden">
                        <table className="w-full"><tbody>
                          <TermRows terms={g.unattributedTerms} omitted={g.omittedUnattributed} />
                        </tbody></table>
                      </div>
                    </td></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TargetRowGroup({ t, expanded, cols, showTopIs, anchor, onAnchor, onToggle }: {
  t: TargetItem; expanded: boolean; cols: number; showTopIs: boolean
  anchor: string | null; onAnchor: (c: ChangeChip) => void; onToggle: () => void
}) {
  return (
    <>
      <tr className={`border-b border-gray-50 cursor-pointer transition-colors ${expanded ? 'bg-orange-50/40' : 'hover:bg-gray-50/50'}`} onClick={onToggle}>
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-300">{expanded ? '▾' : '▸'}</span>
            <span className="text-xs font-medium text-gray-800 truncate max-w-[220px]" title={t.text}>{targetLabel(t.matchType, t.text)}</span>
            {t.state !== 'enabled' && <span className="text-[9px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">{t.state}</span>}
          </div>
        </td>
        <td className="px-2 py-2">{matchBadge(t.matchType)}</td>
        <td className="px-2 py-2"><BidCell prev={t.prevBidCents} cur={t.bidCents} /></td>
        {showTopIs && <td className="px-2 py-2 text-[11px] tabular-nums text-gray-500">{t.topIs != null ? t.topIs.toFixed(1) + '%' : '—'}</td>}
        <td className="px-2 py-2"><ABCell a={t.aSpend} b={t.bSpend} money /></td>
        <td className="px-2 py-2"><ABCell a={t.aSales} b={t.bSales} money /></td>
        <td className="px-2 py-2"><AcosABCell ab={t} /></td>
        <td className="px-2 py-2"><ABCell a={t.aOrders} b={t.bOrders} /></td>
        <td className="px-2 py-2"><ABCell a={t.aClicks} b={t.bClicks} /></td>
        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
          {t.latestChip
            ? <ChipButton chip={{ ...t.latestChip, label: `${fmtDate(t.latestChip.ts)} · ${t.latestChip.label}` }} anchored={anchor === String(t.latestChip.id)} onAnchor={onAnchor} />
            : <span className="text-[10px] text-gray-300">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-50">
          <td colSpan={cols} className="px-4 pb-3 pt-1 bg-orange-50/20">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Bid history <span className="normal-case font-normal">(orange lines = real edits from Amazon)</span></p>
                <BidChart target={t} />
              </div>
              <div className="lg:col-span-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Search terms triggered by this target ({t.searchTerms.length}{t.omittedTermCount > 0 ? ` of ${t.searchTerms.length + t.omittedTermCount}` : ''})</p>
                <div className="bg-white rounded-xl border border-gray-100 overflow-auto max-h-72">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-[9px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                        <th className="px-4 py-1.5 font-medium">Term</th>
                        <th className="px-2 py-1.5 font-medium">Type</th>
                        <th className="px-2 py-1.5 font-medium">Spend</th>
                        <th className="px-2 py-1.5 font-medium">Sales</th>
                        <th className="px-2 py-1.5 font-medium">ACoS</th>
                        <th className="px-2 py-1.5 font-medium">Orders</th>
                        <th className="px-2 py-1.5 font-medium">Clicks</th>
                        <th className="px-2 py-1.5 font-medium">CVR·B</th>
                      </tr>
                    </thead>
                    <tbody><TermRows terms={t.searchTerms} omitted={t.omittedTermCount} /></tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
