import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardNav from '@/components/DashboardNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch connected profiles for the nav switcher
  const { data: profiles } = await supabase
    .from('amazon_profiles')
    .select('profile_id, account_name, marketplace, last_sync_at, sync_enabled')
    .order('created_at')

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardNav user={user} profiles={profiles ?? []} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
