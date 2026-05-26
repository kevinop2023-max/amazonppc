'use client'

import { useState } from 'react'

export default function AcosTargetSetting({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  async function save() {
    const num = Number(value)
    if (!Number.isFinite(num) || num < 1 || num > 200) {
      setStatus('error'); return
    }
    setSaving(true); setStatus('idle')
    const res = await fetch('/api/settings/acos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acos_target: num }),
    })
    setStatus(res.ok ? 'saved' : 'error')
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
        <span className="text-xs text-gray-500 font-medium">Target ACoS</span>
        <input
          type="number"
          min={1} max={200} step={1}
          value={value}
          onChange={e => { setValue(e.target.value); setStatus('idle') }}
          onKeyDown={e => e.key === 'Enter' && save()}
          className="w-14 text-sm font-semibold text-gray-900 text-center outline-none tabular-nums"
        />
        <span className="text-xs text-gray-400">%</span>
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition-all shadow-sm disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {status === 'saved' && <span className="text-xs text-emerald-600 font-medium">Saved</span>}
      {status === 'error' && <span className="text-xs text-red-500 font-medium">Error — enter 1–200</span>}
    </div>
  )
}
