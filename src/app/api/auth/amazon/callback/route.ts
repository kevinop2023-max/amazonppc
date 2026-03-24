// GET /api/auth/amazon/callback
// Amazon redirects here after the user grants/denies access

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, tokenExpiresAt } from '@/lib/amazon-ads/lwa'
import { encryptToken } from '@/lib/amazon-ads/token-crypto'
import { AmazonAdsClient } from '@/lib/amazon-ads/client'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // User denied access
  if (error) {
    return NextResponse.redirect(new URL('/dashboard?amazon_error=denied', request.url))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard?amazon_error=invalid_callback', request.url))
  }

  // Validate CSRF state
  const storedState = request.cookies.get('amazon_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(new URL('/dashboard?amazon_error=state_mismatch', request.url))
  }

  const userId = state.split(':')[0]

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    // Exchange code for tokens
    const tokens    = await exchangeCodeForTokens(code)
    const expiresAt = tokenExpiresAt(tokens.expires_in)

    // Fetch all Amazon Advertising profiles accessible with this token
    const tempClient = new AmazonAdsClient(tokens.access_token, 0)
    const profiles   = await tempClient.getProfiles()

    if (!profiles.length) {
      return NextResponse.redirect(new URL('/dashboard?amazon_error=no_profiles', request.url))
    }

    // Persist each profile to the database (upsert)
    const serviceClient = createServiceClient()
    for (const profile of profiles) {
      await serviceClient
        .from('amazon_profiles')
        .upsert({
          profile_id:        profile.profileId,
          user_id:           user.id,
          marketplace:       profile.accountInfo.marketplaceStringId,
          account_name:      profile.accountInfo.name,
          timezone:          profile.timezone,
          access_token_enc:  encryptToken(tokens.access_token),
          refresh_token_enc: encryptToken(tokens.refresh_token),
          token_expires_at:  expiresAt.toISOString(),
          sync_enabled:      true,
        }, { onConflict: 'profile_id' })
    }

    // Clear the state cookie
    const response = NextResponse.redirect(new URL('/dashboard?amazon_connected=true', request.url))
    response.cookies.delete('amazon_oauth_state')
    return response

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Amazon OAuth callback error:', msg)
    const url = new URL('/dashboard', request.url)
    url.searchParams.set('amazon_error', msg.slice(0, 200))
    return NextResponse.redirect(url)
  }
}
