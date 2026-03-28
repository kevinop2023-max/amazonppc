'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SyncLog {
  id:               number
  status:           string
  started_at:       string
  completed_at:     string | null
  error_message:    string | null
  records_upserted: number | null
}

const statusConfig = {
  success:         { dot: 'bg-emerald-500',            badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'Synced'      },
  running:         { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…'    },
  reports_pending: { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…'    },
  downloading:     { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-50 text-blue-700 border-blue-100',          label: 'Syncing…'    },
  failed:          { dot: 'bg-red-500',                badge: 'bg-red-50 text-red-600 border-red-100',             label: 'Failed'      },
  partial:         { dot: 'bg-amber-500',              badge: 'bg-amber-50 text-amber-700 border-amber-100',       label: 'Partial'     },
  cancelled:       { dot: 'bg-gray-400',               badge: 'bg-gray-50 text-gray-500 border-gray-200',          label: 'Cancelled'   },
}

export default function SyncStatus({ sync: initialSync, profileId }: { sync: SyncLog | null; profileId: number }) {
  const [sync,              setSync]              = useState<SyncLog | null>(initialSync)
  const [syncing,           setSyncing]           = useState(false)
  const [msg,               setMsg]               = useState<string | null>(null)
  const [otherBatchPending, setOtherBatchPending] = useState(false)
  const supabase = useRef(createClient()).current
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const isStale = (sync?.status === 'reports_pending' || sync?.status === 'running' || sync?.status === 'downloading') && sync.started_at
    ? (Date.now() - new Date(sync.started_at).getTime()) > 30 * 60 * 1000
    : false
  const isRunning = ((sync?.status === 'reports_pending' || sync?.status === 'running' || sync?.status === 'downloading') && !isStale) || syncing || otherBatchPending

  // A pending log older than 30 min is stale (Amazon report never completed / edge fn timed out)
  function isFreshPending(log: SyncLog) {
    return (log.status === 'reports_pending' || log.status === 'running' || log.status === 'downloading')
      && !!log.started_at
      && Date.now() - new Date(log.started_at).getTime() < 30 * 60 * 1000
  }

  // On mount: check if any recent batch is pending (handles page refresh mid-sync)
  useEffect(() => {
    async function checkInitial() {
      const { data: logs } = await supabase
        .from('sync_logs')
        .select('id, status, started_at, completed_at, error_message, records_upserted')
        .eq('profile_id', profileId)
        .order('started_at', { ascending: false })
        .limit(4)
      if (!logs?.length) return
      const pending = logs.some(isFreshPending)
      setOtherBatchPending(pending)
      // Only overwrite the server-computed display value when there are active pending batches
      if (pending) setSync(logs[0])
    }
    checkInitial()
  }, [profileId, supabase])

  // Poll every 10s while sync is in progress
  useEffect(() => {
    if (!isRunning) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    async function poll() {
      const { data: logs } = await supabase
        .from('sync_logs')
        .select('id, status, started_at, completed_at, error_message, records_upserted')
        .eq('profile_id', profileId)
        .order('started_at', { ascending: false })
        .limit(4)
      if (!logs?.length) return

      // Check if any batch is still pending (ignore stale logs)
      const anyPending = logs.some(isFreshPending)
      const latestLog  = logs[0]

      setSync(latestLog)
      setOtherBatchPending(anyPending)

      if (!anyPending && !syncing) {
        setSyncing(false)
        // Sum only the current sync session (batches started within 5 min of the latest log)
        const latestStarted = latestLog?.started_at ? new Date(latestLog.started_at).getTime() : Date.now()
        const sessionStart  = latestStarted - 5 * 60 * 1000
        const total = logs
          .filter(l => l.status === 'success' && l.started_at && new Date(l.started_at).getTime() >= sessionStart)
          .reduce((s, l) => s + (l.records_upserted ?? 0), 0)
        if (total > 0) setMsg(`✓ Sync complete — ${total.toLocaleString()} records`)
      }
    }
    pollRef.current = setInterval(poll, 10000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [isRunning, profileId, supabase, syncing])

  async function triggerSync() {
    setSyncing(true)
    setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-profile', {
        body: { profile_id: profileId, triggered_by: 'manual' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? 'Failed to start sync')
      setMsg('✓ Sync started (2 batches) — data will update in 10–15 minutes')
      // Refresh sync log to get the new id
      const { data: log } = await supabase
        .from('sync_logs')
        .select('id, status, started_at, completed_at, error_message, records_upserted')
        .eq('profile_id', profileId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (log) setSync(log)
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to trigger sync')
      setSyncing(false)
    }
  }

  async function stopSync() {
    try {
      const { error } = await supabase.functions.invoke('cancel-sync', {
        body: { profile_id: profileId },
      })
      if (error) throw error
      setSyncing(false)
      setOtherBatchPending(false)
      setSync(prev => prev ? { ...prev, status: 'cancelled', completed_at: new Date().toISOString() } : prev)
      setMsg('Sync cancelled')
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to cancel sync')
    }
  }

  const cfg       = sync ? (statusConfig[sync.status as keyof typeof statusConfig] ?? statusConfig.partial) : null
  const lastTime  = sync?.completed_at ?? sync?.started_at
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

      {sync?.records_upserted != null && sync.status === 'success' && !otherBatchPending && !msg && (
        <p className="text-xs text-emerald-600 mb-2">{sync.records_upserted.toLocaleString()} records synced</p>
      )}

      {isRunning && otherBatchPending && sync?.status === 'success' && (
        <p className="text-xs text-blue-600 mb-2">1 of 2 batches complete — finishing up…</p>
      )}

      {sync?.error_message && sync.status === 'failed' && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <p className="text-xs text-red-600 break-all">{sync.error_message}</p>
        </div>
      )}

      {msg && (
        <div className={`rounded-xl p-3 mb-3 ${msg.startsWith('✓') ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
          <p className={`text-xs font-medium ${msg.startsWith('✓') ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</p>
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button
          onClick={triggerSync}
          disabled={isRunning}
          className="flex-1 text-xs font-semibold py-2.5 px-4 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {isRunning ? 'Syncing…' : '↻  Sync now'}
        </button>

        {isRunning && (
          <button
            onClick={stopSync}
            className="text-xs font-semibold py-2.5 px-4 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-all"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
