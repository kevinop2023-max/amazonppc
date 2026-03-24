// GET  /api/v1/alerts?profile_id=xxx&severity=high
// POST /api/v1/alerts/:id/dismiss

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const profileId = Number(searchParams.get('profile_id'))
  const severity  = searchParams.get('severity')

  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  let query = supabase
    .from('alerts')
    .select('*')
    .eq('profile_id', profileId)
    .is('dismissed_at', null)      // active alerts only
    .order('triggered_at', { ascending: false })

  if (severity) query = query.eq('severity', severity)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ alerts: data, count: data?.length ?? 0 })
}
