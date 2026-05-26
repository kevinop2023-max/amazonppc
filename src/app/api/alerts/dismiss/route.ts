import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { alert_id, reason } = await req.json()
  if (!alert_id) return NextResponse.json({ error: 'alert_id required' }, { status: 400 })

  // Scope the update to profiles owned by this user — prevents integer ID guessing attacks
  const { data: userProfiles } = await supabase.from('amazon_profiles').select('profile_id')
  const profileIds = (userProfiles ?? []).map((p: any) => p.profile_id)
  if (!profileIds.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabase
    .from('alerts')
    .update({ dismissed_at: new Date().toISOString(), dismiss_reason: reason ?? null })
    .eq('id', alert_id)
    .in('profile_id', profileIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
