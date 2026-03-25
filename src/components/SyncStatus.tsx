'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SyncLog {
  id:            number
  status:        string
  started_at:    string
  completed_at:  string | null
  error_message: string | null
  records_upserted: number | null
}

export default function SyncStatus({ sync: initialSync, profileId }: { sync: SyncLog | null; profileId: number }) {
  const [sync,    setSync]    = useState<SyncLog | null>(initialSync)
  const [syncing, setSyncing] = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logIdRef = useRef<number | null>(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function callSyncPoll() {
    const supabase = createClient()
    const body: any = {}
    if (logIdRef.current) body.log_id = logIdRef.current
    const { data, error } = await supabase.functions.invoke('sync-poll', { body })
    if (error) { console.error('poll error:', error); return }

    if (data?.status === 'success') {
      stopPolling()
      setSyncing(false)
      setMsg(`✓ Synced ${data.records_upserted ?? 0} records`)
      setSync(prev => prev ? { ...prev, status: 'success', records_upserted: data.records_upserted, completed_at: new Date().toISOString() } : prev)
    } else if (data?.status === 'failed') {
      stopPolling()
      setSyncing(false)
      setMsg('Sync failed — check logs')
      setSync(prev => prev ? { ...prev, status: 'failed' } : prev)
    } else if (data?.status === 'no_pending') {
      stopPolling()
      setSyncing(false)
    }
    // still reports_pending → keep polling
  }

  function startPolling(logId: number) {
    logIdRef.current = logId
    stopPolling()
    // Poll immediately, then every 15s
    callSyncPoll()
    pollRef.current = setInterval(callSyncPoll, 15000)
  }

  useEffect(() => () => stopPolling(), [])

  async function triggerSync() {
    setSyncing(true)
    setMsg(null)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.functions.invoke('sync-profile', {
        body: { profile_id: profileId, triggered_by: 'manual' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? 'Failed to start sync')

      setMsg('Syncing… checking report status every 15s')
      setSync(prev => ({ ...(prev ?? { id: 0, started_at: new Date().toISOString(), completed_at: null, error_message: null, records_upserted: null }), status: 'running' } as SyncLog))
      startPolling(data.log_id)
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to trigger sync')
      setSyncing(false)
    }
  }

  const isRunning = sync?.status === 'running' || sync?.status === 'reports_pending' || syncing

  const statusConfig = {
    success:         { dot: 'bg-emerald-500',              badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'Synced' },
    running:         { dot: 'bg-blue-500 animate-pulse',   badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…' },
    reports_pending: { dot: 'bg-blue-500 animate-pulse',   badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Processing…' },
    failed:          { dot: 'bg-red-500',                  badge: 'bg-red-50 text-red-600 border-red-100',             label: 'Failed' },
    partial:         { dot: 'bg-amber-500',                badge: 'bg-amber-50 text-amber-700 border-amber-100',       label: 'Partial' },
  }

  const cfg     = sync ? (statusConfig[sync.status as keyof typeof statusConfig] ?? statusConfig.partial) : null
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
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">Never synced</span>
        )}
      </div>

      {timeLabel && (
        <p className="text-xs text-gray-400 mb-2" suppressHydrationWarning>Last sync: {timeLabel}</p>
      )}

      {sync?.records_upserted != null && sync.status === 'success' && (
        <p className="text-xs text-emerald-600 mb-2">{sync.records_upserted.toLocaleString()} records synced</p>
      )}

      {sync?.error_message && sync.status === 'failed' && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <p className="text-xs text-red-600 break-all">{sync.error_message}</p>
        </div>
      )}

      {msg && (
        <div className={`rounded-xl p-3 mb-3 ${msg.startsWith('✓') ? 'bg-emerald-50 border border-emerald-100' : 'bg-blue-50 border border-blue-100'}`}>
          <p className={`text-xs font-medium ${msg.startsWith('✓') ? 'text-emerald-700' : 'text-blue-700'}`}>{msg}</p>
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
