// POST /api/v1/sync  — trigger manual sync for a profile
// GET  /api/v1/sync  — get status of last sync

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncProfile } from '@/lib/amazon-ads/sync-engine'

// Allow up to 5 minutes for sync (requires Vercel Pro)
export const maxDuration = 300

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

// POST: trigger manual sync (rate-limited to 3 per day)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id: profileId } = await request.json()
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  // Rate limit: max 3 manual syncs per day
  const since = new Date()
  since.setHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('sync_logs')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('triggered_by', 'manual')
    .gte('started_at', since.toISOString())

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Manual sync limit reached (10 per day).' }, { status: 429 })
  }

  // Run the actual sync
  const result = await syncProfile(Number(profileId), 'manual')

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ success: true, records_upserted: result.recordsUpserted })
}
