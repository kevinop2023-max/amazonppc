// Pure date/A-B helpers for the Targets page (client-safe, no imports).

export function clientDateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().split('T')[0]
}

export function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

export function diffDays(a: string, b: string) {
  return Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000)
}

export function quickSplit(totalDays: number) {
  const half = Math.floor(totalDays / 2)
  return {
    aStart: clientDateStr(totalDays),
    aEnd:   clientDateStr(half + 1),
    bStart: clientDateStr(half),
    bEnd:   clientDateStr(1),
  }
}

export function allTimeSplit(earliest: string) {
  const start = new Date(earliest + 'T12:00:00Z')
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const mid = new Date((start.getTime() + yesterday.getTime()) / 2)
  return {
    aStart: earliest,
    aEnd:   mid.toISOString().split('T')[0],
    bStart: new Date(mid.getTime() + 86400000).toISOString().split('T')[0],
    bEnd:   yesterday.toISOString().split('T')[0],
  }
}

// Change-impact anchor: B = from the change day THROUGH yesterday (full read since the
// change), A = the same number of days immediately before the change.
export function anchorWindows(eventTs: string, earliest: string | null) {
  const change = eventTs.slice(0, 10)
  const yesterday = clientDateStr(1)
  const n = Math.max(1, diffDays(change, yesterday) + 1)
  const bStart = change
  const bEnd = change < yesterday ? yesterday : change
  const aEnd = addDays(change, -1)
  let aStart = addDays(change, -n)
  if (earliest && aStart < earliest) aStart = earliest
  return { aStart, aEnd, bStart, bEnd, n }
}

export function fmtD(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtDate(s: string) {
  return new Date(s.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function acosPct(spend: number, sales: number): number | null {
  return sales > 0 ? spend / sales * 100 : null
}

export function pctChg(a: number, b: number): number | null {
  return a === 0 ? null : (b - a) / a * 100
}
