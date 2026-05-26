import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import DashboardNav from '@/components/DashboardNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Use service client for role lookup so RLS never blocks it
  const service = createServiceClient()

  const [profilesRes, roleRes] = await Promise.all([
    supabase
      .from('amazon_profiles')
      .select('profile_id, account_name, marketplace, last_sync_at, sync_enabled')
      .order('created_at'),
    service
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single(),
  ])

  const isAdmin = roleRes.data?.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardNav user={user} profiles={profilesRes.data ?? []} isAdmin={isAdmin} />
      <main className="w-full px-[75px] py-8">
        {children}
      </main>
    </div>
  )
}
