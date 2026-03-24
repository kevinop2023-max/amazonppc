// POST /api/v1/sync  — trigger manual sync for a profile
// GET  /api/v1/sync  — get status of last sync for a profile

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET: last sync status
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profileId = Number(new URL(request.url).searchParams.get('profile_id'))
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('sync_logs')
    .select('*')
    .eq('profile_id', profileId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return NextResponse.json({ sync: null })
  return NextResponse.json({ sync: data })
}

// POST: trigger manual sync (rate-limited to 3 per day per profile)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id: profileId } = await request.json()
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  // Rate limit: max 3 manual syncs per day per profile
  const since = new Date()
  since.setHours(0, 0, 0, 0)

  const serviceClient = createServiceClient()
  const { count } = await serviceClient
    .from('sync_logs')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('triggered_by', 'manual')
    .gte('started_at', since.toISOString())

  if ((count ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'Manual sync limit reached (3 per day). Try again tomorrow.' },
      { status: 429 }
    )
  }

  // Insert a pending sync log — the sync worker will pick this up
  const { data: log, error } = await serviceClient
    .from('sync_logs')
    .insert({
      profile_id:   profileId,
      triggered_by: 'manual',
      status:       'running',
      started_at:   new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // TODO: In production, enqueue the actual sync job here (pg-boss / BullMQ)
  // For now, return the log ID so the UI can poll for status
  return NextResponse.json({ sync_id: log.id, status: 'running' })
}
