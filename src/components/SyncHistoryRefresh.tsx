'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function SyncHistoryRefresh() {
  const router = useRouter()
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Auto-refresh every 15s so in-progress syncs appear without manual reload
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh()
      setLastRefresh(new Date())
    }, 15000)
    return () => clearInterval(id)
  }, [router])

  function handleRefresh() {
    router.refresh()
    setLastRefresh(new Date())
  }

  return (
    <div className="flex items-center gap-3">
      {lastRefresh && (
        <span className="text-xs text-gray-400" suppressHydrationWarning>
          Updated {lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
      <button
        onClick={handleRefresh}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all"
      >
        ↻ Refresh
      </button>
    </div>
  )
}
