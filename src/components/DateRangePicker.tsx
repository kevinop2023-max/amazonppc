'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function DateRangePicker({
  start,
  end,
}: {
  start: string
  end: string
}) {
  const [startVal, setStartVal] = useState(start)
  const [endVal,   setEndVal]   = useState(end)
  const router = useRouter()
  const searchParams = useSearchParams()

  function apply() {
    if (!startVal || !endVal) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('start', startVal)
    params.set('end', endVal)
    params.delete('days')
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={startVal}
        max={endVal}
        onChange={e => setStartVal(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />
      <span className="text-xs text-gray-400">—</span>
      <input
        type="date"
        value={endVal}
        min={startVal}
        onChange={e => setEndVal(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />
      <button
        onClick={apply}
        className="text-xs font-semibold px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
      >
        Apply
      </button>
    </div>
  )
}
