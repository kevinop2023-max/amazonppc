// Daily cron sync — called by Vercel Cron at 6:00 AM UTC
// Configured in vercel.json
// Delegates to the sync-profile Supabase Edge Function (same as manual sync)

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const results = []
  for (const { profile_id } of profiles) {
    const res = await fetch(`${supabaseUrl}/functions/v1/sync-profile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profile_id, triggered_by: 'scheduler' }),
    })
    const data = await res.json()
    results.push({ profile_id, ...data })
  }

  return NextResponse.json({ synced: results.length, results })
}
