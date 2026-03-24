// GET /api/auth/amazon
// Redirects the user to Amazon's OAuth authorization page

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizationUrl } from '@/lib/amazon-ads/lwa'
import { randomBytes } from 'crypto'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Generate a CSRF state token tied to this user's session
  const state = `${user.id}:${randomBytes(16).toString('hex')}`

  const authUrl = buildAuthorizationUrl(state)

  // Store state in a short-lived cookie for validation in callback
  const response = NextResponse.redirect(authUrl)
  response.cookies.set('amazon_oauth_state', state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   600,  // 10 minutes
    path:     '/',
    sameSite: 'lax',
  })

  return response
}
