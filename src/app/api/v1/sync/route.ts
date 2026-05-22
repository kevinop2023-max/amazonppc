// POST /api/v1/sync  — trigger manual sync for a profile
// GET  /api/v1/sync  — get status of last sync

export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: last sync status
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profileId = Number(new URL(request.url).searchParams.get('profile_id'))
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const { data } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('profile_id', profileId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ sync: data ?? null })
}

// POST: trigger manual sync — fires the Supabase edge function and returns quickly.
// The edge function takes 100-130s (sequential report creation); we wait up to 12s for
// a fast rejection (guard/auth), then return success so Vercel doesn't time out.
// SyncStatus.tsx polls sync_logs directly to track progress.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id: profileId } = await request.json()
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const functionUrl    = `${supabaseUrl}/functions/v1/sync-profile`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch(functionUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey':        serviceRoleKey,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify({ profile_id: profileId, triggered_by: 'manual' }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data?.error ?? `Function error (${res.status})` }, { status: res.status })
    return NextResponse.json(data)
  } catch (e: any) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') {
      // Edge function is still running on Supabase — reports are being submitted.
      // Return success; SyncStatus.tsx will detect the new sync_log via polling.
      return NextResponse.json({ success: true, message: 'Sync started — data will update in 10–15 minutes' })
    }
    return NextResponse.json({ error: 'Failed to reach sync function' }, { status: 502 })
  }
}
