'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DismissButton({ alertId }: { alertId: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function dismiss() {
    setBusy(true)
    await fetch('/api/alerts/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_id: alertId }),
    })
    router.refresh()
  }

  return (
    <button
      onClick={dismiss}
      disabled={busy}
      className="text-[11px] font-medium text-gray-400 hover:text-gray-600 border border-gray-200 px-2.5 py-1 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
    >
      {busy ? '…' : 'Dismiss'}
    </button>
  )
}
