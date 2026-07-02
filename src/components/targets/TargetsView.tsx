'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CampaignGroup, NegRow, ChangeChip } from './types'
import { quickSplit, allTimeSplit, anchorWindows, fmtDate } from './ab'
import CampaignSection from './CampaignSection'

interface Props {
  profileId: number
  aStart: string; aEnd: string; bStart: string; bEnd: string
  adType: 'all' | 'sp' | 'sb'
  tab: string
  anchor: string | null
  earliestDate: string | null
  groups: CampaignGroup[]
  negGroups: [string, NegRow[]][]
  tabCounts: Record<string, number>
}

const TABS = [
  { key: 'all', label: 'All Targets' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'products', label: 'Products' },
  { key: 'auto', label: 'Auto' },
  { key: 'negatives', label: 'Negatives' },
]

export default function TargetsView({ profileId, aStart, aEnd, bStart, bEnd, adType, tab, anchor, earliestDate, groups, negGroups, tabCounts }: Props) {
  const router = useRouter()
  const [dA1, setDA1] = useState(aStart); const [dA2, setDA2] = useState(aEnd)
  const [dB1, setDB1] = useState(bStart); const [dB2, setDB2] = useState(bEnd)
  const [campaignSearch, setCampaignSearch] = useState('')
  const [showPaused, setShowPaused] = useState(false)

  const push = (params: Record<string, string | null | undefined>) => {
    const base: Record<string, string | null | undefined> = {
      profile_id: String(profileId), aStart: dA1, aEnd: dA2, bStart: dB1, bEnd: dB2,
      adType: adType === 'all' ? undefined : adType,
      tab: tab === 'all' ? undefined : tab,
      ...params,
    }
    const qs = Object.entries(base).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    router.push(`/dashboard/targets?${qs}`)
  }

  const applyDates = (w: { aStart: string; aEnd: string; bStart: string; bEnd: string }) => {
    setDA1(w.aStart); setDA2(w.aEnd); setDB1(w.bStart); setDB2(w.bEnd)
    push({ aStart: w.aStart, aEnd: w.aEnd, bStart: w.bStart, bEnd: w.bEnd, anchor: null })
  }

  // Anchor a change: A = window before the change, B = window from the change onward
  const onAnchor = (chip: ChangeChip) => {
    const w = anchorWindows(chip.ts, earliestDate)
    setDA1(w.aStart); setDA2(w.aEnd); setDB1(w.bStart); setDB2(w.bEnd)
    push({ aStart: w.aStart, aEnd: w.aEnd, bStart: w.bStart, bEnd: w.bEnd, anchor: String(chip.id) })
  }

  const anchoredGroupId = useMemo(() => {
    if (!anchor) return null
    for (const g of groups) if (
      g.changeChips.some(c => String(c.id) === anchor) ||
      g.placements.some(p => p.chips.some(c => String(c.id) === anchor)) ||
      g.targets.some(t => t.latestChip && String(t.latestChip.id) === anchor)
    ) return `${g.adType}|${g.id}`
    return null
  }, [anchor, groups])

  const visibleGroups = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase()
    return groups.filter(g =>
      (showPaused || g.state === 'enabled' || `${g.adType}|${g.id}` === anchoredGroupId) &&
      (!q || g.name.toLowerCase().includes(q))
    )
  }, [groups, campaignSearch, showPaused, anchoredGroupId])

  const totalTargets = groups.reduce((s, g) => s + g.targets.length, 0)
  const bDays = Math.round((new Date(bEnd + 'T12:00:00Z').getTime() - new Date(bStart + 'T12:00:00Z').getTime()) / 86400000) + 1

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Targets</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {totalTargets} targets · {groups.length} campaigns · comparing <span className="font-medium text-gray-500">A</span> {fmtDate(aStart)}–{fmtDate(aEnd)} vs <span className="font-medium text-gray-500">B</span> {fmtDate(bStart)}–{fmtDate(bEnd)}
          </p>
        </div>
        {/* Ad type toggle */}
        <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
          {([['all', 'All'], ['sp', 'SP'], ['sb', 'SB']] as const).map(([t, label]) => (
            <button key={t} onClick={() => push({ adType: t === 'all' ? undefined : t, anchor: null })}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                adType === t
                  ? t === 'sp' ? 'bg-blue-500 text-white' : t === 'sb' ? 'bg-purple-500 text-white' : 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* A/B period controls */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-1">
            {[14, 30, 60].map(d => (
              <button key={d} onClick={() => applyDates(quickSplit(d))}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-50 border border-gray-100">
                {d / 2}d vs {d / 2}d
              </button>
            ))}
            {earliestDate && (
              <button onClick={() => applyDates(allTimeSplit(earliestDate))}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-50 border border-gray-100">
                All time halves
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Period A (before)</p>
              <div className="flex items-center gap-1">
                <input type="date" value={dA1} onChange={e => setDA1(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                <span className="text-gray-300 text-xs">–</span>
                <input type="date" value={dA2} onChange={e => setDA2(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Period B (after)</p>
              <div className="flex items-center gap-1">
                <input type="date" value={dB1} onChange={e => setDB1(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                <span className="text-gray-300 text-xs">–</span>
                <input type="date" value={dB2} onChange={e => setDB2(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              </div>
            </div>
            <button onClick={() => push({ aStart: dA1, aEnd: dA2, bStart: dB1, bEnd: dB2, anchor: null })}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
              Compare
            </button>
          </div>
          {anchor && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
              ⚓ Anchored to a change — A = before, B = after{bDays < 3 ? ` (early read: only ${bDays} day${bDays > 1 ? 's' : ''} after)` : ''}
              <button onClick={() => push({ anchor: null })} className="ml-1 text-orange-400 hover:text-orange-700">✕</button>
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Tip: click any change chip (bid / placement / budget) inside a campaign to auto-set A/B to before vs after that change.</p>
      </div>

      {/* Tabs + campaign search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 shadow-sm">
          {TABS.filter(t => !(adType === 'sb' && t.key === 'auto')).map(t => (
            <button key={t.key} onClick={() => push({ tab: t.key === 'all' ? undefined : t.key })}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === t.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
              {t.label}{tabCounts[t.key] ? <span className="ml-1 opacity-60">{tabCounts[t.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showPaused} onChange={e => setShowPaused(e.target.checked)} className="accent-orange-500" />
            Show paused
          </label>
          <input value={campaignSearch} onChange={e => setCampaignSearch(e.target.value)} placeholder="Search campaign…"
            className="px-3 py-2 text-xs border border-gray-200 rounded-xl w-52 focus:outline-none focus:ring-2 focus:ring-orange-200" />
        </div>
      </div>

      {/* Negatives tab */}
      {tab === 'negatives' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2.5 font-medium">Keyword / Target</th>
                <th className="px-4 py-2.5 font-medium">Match Type</th>
                <th className="px-4 py-2.5 font-medium">Level</th>
                <th className="px-4 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {negGroups.filter(([name]) => !campaignSearch.trim() || name.toLowerCase().includes(campaignSearch.trim().toLowerCase())).map(([name, rows]) => (
                <NegGroup key={name} name={name} rows={rows} />
              ))}
              {negGroups.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No negatives found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Campaign accordion */}
      {tab !== 'negatives' && (
        <div className="space-y-3">
          {visibleGroups.map(g => (
            <CampaignSection key={`${g.adType}-${g.id}`} group={g} tab={tab} anchor={anchor}
              defaultOpen={`${g.adType}|${g.id}` === anchoredGroupId}
              onAnchor={onAnchor} />
          ))}
          {visibleGroups.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center text-sm text-gray-400">
              No campaigns match. {!showPaused && 'Paused campaigns are hidden — enable "Show paused".'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NegGroup({ name, rows }: { name: string; rows: NegRow[] }) {
  return (
    <>
      <tr className="bg-gray-50/80 border-b border-gray-100">
        <td colSpan={4} className="px-4 py-2 text-xs font-bold text-gray-600">{name} <span className="font-normal text-gray-400">· {rows.length}</span></td>
      </tr>
      {rows.map(r => (
        <tr key={r.key} className="border-b border-gray-50 hover:bg-gray-50/50">
          <td className="px-4 py-2 text-xs text-gray-800">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mr-2 ${r.adTypeMark === 'SP' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{r.adTypeMark}</span>
            {r.text || '—'}
          </td>
          <td className="px-4 py-2 text-xs text-gray-500">{r.matchType}</td>
          <td className="px-4 py-2 text-xs text-gray-500">{r.level}</td>
          <td className="px-4 py-2 text-xs text-gray-500">{r.state}</td>
        </tr>
      ))}
    </>
  )
}
