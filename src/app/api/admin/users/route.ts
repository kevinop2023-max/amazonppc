import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const service = createServiceClient()
  const { data } = await service.from('user_roles').select('role').eq('user_id', user.id).single()
  return data?.role === 'admin' ? service : null
}

// Update user: role, name, password (any subset)
export async function PUT(req: NextRequest) {
  const service = await requireAdmin()
  if (!service) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { user_id, role, name, password } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  if (name !== undefined || password) {
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.user_metadata = { full_name: name }
    if (password) updates.password = password
    const { error } = await service.auth.admin.updateUserById(user_id, updates)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    const { error } = await service.from('user_roles').upsert({ user_id, role }, { onConflict: 'user_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// Create new user
export async function POST(req: NextRequest) {
  const service = await requireAdmin()
  if (!service) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, password, name, role } = await req.json()
  if (!email || !password) return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name: name ?? '' },
    email_confirm: true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const userRole: 'admin' | 'user' = role === 'admin' ? 'admin' : 'user'
  await service.from('user_roles').insert({ user_id: data.user.id, role: userRole })

  return NextResponse.json({
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email ?? '',
      name: name ?? '',
      createdAt: data.user.created_at,
      lastSignIn: null,
      role: userRole,
    },
  })
}

// Delete user
export async function DELETE(req: NextRequest) {
  const service = await requireAdmin()
  if (!service) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { user_id } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const { error } = await service.auth.admin.deleteUser(user_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
