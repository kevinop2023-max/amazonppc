// Login with Amazon (LWA) - OAuth 2.0 token management

import { AMAZON_ADS_CONFIG, LWA_CLIENT_ID, LWA_CLIENT_SECRET, APP_REDIRECT_URI } from './config'

export interface LwaTokenResponse {
  access_token:  string
  refresh_token: string
  token_type:    string
  expires_in:    number  // seconds
}

// Step 1: Build the OAuth authorization URL to redirect the user to Amazon
export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     LWA_CLIENT_ID,
    scope:         AMAZON_ADS_CONFIG.scope,
    response_type: 'code',
    redirect_uri:  APP_REDIRECT_URI,
    state,
  })
  return `${AMAZON_ADS_CONFIG.lwaAuthUrl}?${params.toString()}`
}

// Step 2: Exchange the authorization code (from callback) for tokens
export async function exchangeCodeForTokens(code: string): Promise<LwaTokenResponse> {
  const res = await fetch(AMAZON_ADS_CONFIG.lwaTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  APP_REDIRECT_URI,
      client_id:     LWA_CLIENT_ID,
      client_secret: LWA_CLIENT_SECRET,
    }).toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LWA token exchange failed: ${res.status} ${err}`)
  }

  return res.json()
}

// Refresh an expired access token using the stored refresh token
export async function refreshAccessToken(refreshToken: string): Promise<LwaTokenResponse> {
  const res = await fetch(AMAZON_ADS_CONFIG.lwaTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     LWA_CLIENT_ID,
      client_secret: LWA_CLIENT_SECRET,
    }).toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LWA token refresh failed: ${res.status} ${err}`)
  }

  return res.json()
}

// Calculate token expiry timestamp from expires_in seconds
export function tokenExpiresAt(expiresIn: number): Date {
  return new Date(Date.now() + (expiresIn - 60) * 1000)  // subtract 60s buffer
}
