import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import UserRoleTable from '@/components/UserRoleTable'

export const revalidate = 0

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (roleRow?.role !== 'admin') redirect('/dashboard')

  const service = createServiceClient()
  const { data: listData } = await service.auth.admin.listUsers({ perPage: 200 })
  const authUsers = listData?.users ?? []

  const { data: roleRows } = await service
    .from('user_roles')
    .select('user_id, role, created_at')

  const roleMap = new Map((roleRows ?? []).map(r => [r.user_id, r.role as 'admin' | 'user']))

  const users = authUsers.map(u => ({
    id: u.id,
    email: u.email ?? '',
    name: (u.user_metadata?.full_name as string) ?? '',
    createdAt: u.created_at,
    lastSignIn: u.last_sign_in_at ?? null,
    role: roleMap.get(u.id) ?? 'user' as 'admin' | 'user',
  }))

  users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">User Management</h1>
        <p className="text-xs text-gray-400 mt-0.5">{users.length} account{users.length !== 1 ? 's' : ''}</p>
      </div>
      <UserRoleTable users={users} currentUserId={user.id} />
    </div>
  )
}
