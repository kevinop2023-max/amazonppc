import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { acos_target } = await req.json()
  const val = Number(acos_target)
  if (!Number.isFinite(val) || val < 1 || val > 200) {
    return NextResponse.json({ error: 'acos_target must be 1–200' }, { status: 400 })
  }

  const { error } = await supabase
    .from('users')
    .update({ settings: { acos_target: val } })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, acos_target: val })
}
