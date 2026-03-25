'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SyncLog {
  status:        string
  started_at:    string
  completed_at:  string | null
  error_message: string | null
}

export default function SyncStatus({ sync, profileId }: { sync: SyncLog | null; profileId: number }) {
  const [syncing, setSyncing] = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)

  async function triggerSync() {
    setSyncing(true)
    setMsg(null)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.functions.invoke('sync-profile', {
        body: { profile_id: profileId, triggered_by: 'manual' },
      })
      if (error) throw error
      setMsg(data?.success ? `✓ Synced ${data.records_upserted ?? 0} records` : (data?.error ?? 'Sync failed'))
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to trigger sync')
    }
    setSyncing(false)
  }

  const isRunning = sync?.status === 'running' || syncing

  const statusConfig = {
    success: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'Synced' },
    running: { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-50 text-blue-700 border-blue-100', label: 'Syncing…' },
    failed:  { dot: 'bg-red-500',     badge: 'bg-red-50 text-red-600 border-red-100', label: 'Failed' },
    partial: { dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-100', label: 'Partial' },
  }

  const cfg = sync ? (statusConfig[sync.status as keyof typeof statusConfig] ?? statusConfig.partial) : null

  const lastTime = sync?.completed_at ?? sync?.started_at
  const timeLabel = lastTime
    ? new Date(lastTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Data Sync</h3>
        {cfg ? (
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </span>
        ) : (
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
            Never synced
          </span>
        )}
      </div>

      {timeLabel && (
        <p className="text-xs text-gray-400 mb-2" suppressHydrationWarning>Last sync: {timeLabel}</p>
      )}

      {sync?.error_message && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <p className="text-xs text-red-600">{sync.error_message}</p>
        </div>
      )}

      {msg && (
        <div className={`rounded-xl p-3 mb-3 ${msg.startsWith('✓') ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
          <p className={`text-xs font-medium ${msg.startsWith('✓') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>
        </div>
      )}

      <button
        onClick={triggerSync}
        disabled={isRunning}
        className="w-full mt-1 text-xs font-semibold py-2.5 px-4 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 transition-all"
      >
        {isRunning ? 'Sync in progress…' : '↻  Sync now'}
      </button>
    </div>
  )
}
