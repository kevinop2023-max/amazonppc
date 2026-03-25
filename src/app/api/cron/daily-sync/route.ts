// Daily cron sync — called by Vercel Cron at 6:00 AM UTC
// Configured in vercel.json

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncProfile } from '@/lib/amazon-ads/sync-engine'

export const maxDuration = 300

export async function GET(request: Request) {
  // Verify this is called by Vercel Cron (not a public request)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data: profiles } = await db
    .from('amazon_profiles')
    .select('profile_id')
    .eq('sync_enabled', true)

  if (!profiles?.length) {
    return NextResponse.json({ message: 'No profiles to sync' })
  }

  const results = []
  for (const { profile_id } of profiles) {
    const result = await syncProfile(profile_id, 'scheduler')
    results.push({ profile_id, ...result })
  }

  return NextResponse.json({ synced: results.length, results })
}
