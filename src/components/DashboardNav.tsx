'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

interface Profile {
  profile_id:  number
  account_name: string | null
  marketplace:  string
  last_sync_at: string | null
  sync_enabled: boolean
}

export default function DashboardNav({ user, profiles }: { user: User; profiles: Profile[] }) {
  const pathname = usePathname() ?? ''
  const router   = useRouter()
  const supabase = useRef(createClient()).current   // stable ref — avoids hydration mismatch

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const links = [
    { href: '/dashboard',              label: 'Overview',      icon: '▤' },
    { href: '/dashboard/campaigns',    label: 'Campaigns',     icon: '◈' },
    { href: '/dashboard/search-terms', label: 'Search Terms',  icon: '⌕' },
    { href: '/dashboard/keywords',     label: 'Keywords',      icon: '◇' },
    { href: '/dashboard/alerts',       label: 'Alerts',        icon: '◉' },
  ]

  const activeProfile = profiles[0]

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Left: Logo + Links */}
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
              <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="font-bold text-gray-900 text-sm">PPC Analytics</span>
            </Link>

            <div className="hidden md:flex items-center gap-0.5">
              {links.map(link => {
                const active = pathname === link.href
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-orange-50 text-orange-700'
                        : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right: Profile status + user */}
          <div className="flex items-center gap-3">
            {profiles.length === 0 ? (
              <a
                href="/api/auth/amazon"
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Connect Amazon
              </a>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-700 text-xs font-medium px-2.5 py-1.5 rounded-lg">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                {activeProfile.account_name ?? `Profile ${activeProfile.profile_id}`}
                {profiles.length > 1 && <span className="text-green-500">+{profiles.length - 1}</span>}
              </div>
            )}

            <div className="flex items-center gap-2 pl-3 border-l border-gray-100">
              <span className="hidden sm:block text-xs text-gray-400 max-w-[140px] truncate">{user.email}</span>
              <button
                onClick={signOut}
                className="text-xs text-gray-500 hover:text-red-600 font-medium transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>

        </div>
      </div>
    </nav>
  )
}
