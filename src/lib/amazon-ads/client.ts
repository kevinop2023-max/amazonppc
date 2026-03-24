// Amazon Ads API HTTP client with auto token refresh and rate limiting

import { AMAZON_ADS_CONFIG } from './config'
import { refreshAccessToken, tokenExpiresAt } from './lwa'
import { encryptToken, decryptToken } from './token-crypto'
import { createServiceClient } from '@/lib/supabase/server'

export interface AmazonProfile {
  profileId:   number
  countryCode: string
  currencyCode: string
  timezone:    string
  accountInfo: {
    marketplaceStringId: string
    name:                string
    type:                string
  }
}

export class AmazonAdsClient {
  private accessToken:  string
  private profileId:    number
  private region:       'NA' | 'EU' | 'FE'
  private baseUrl:      string

  constructor(accessToken: string, profileId: number, region: 'NA' | 'EU' | 'FE' = 'NA') {
    this.accessToken = accessToken
    this.profileId   = profileId
    this.region      = region
    this.baseUrl     = AMAZON_ADS_CONFIG.apiBaseUrl[region]
  }

  // Build request headers required by Amazon Ads API
  private headers(): Record<string, string> {
    return {
      'Authorization':          `Bearer ${this.accessToken}`,
      'Amazon-Advertising-API-ClientId': process.env.AMAZON_LWA_CLIENT_ID!,
      'Amazon-Advertising-API-Scope':    String(this.profileId),
      'Content-Type':           'application/json',
      'Accept':                 'application/json',
    }
  }

  // Generic GET request
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    }
    const res = await fetch(url.toString(), { headers: this.headers() })
    if (!res.ok) throw new Error(`Amazon Ads API GET ${path} failed: ${res.status} ${await res.text()}`)
    return res.json()
  }

  // Generic POST request
  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method:  'POST',
      headers: this.headers(),
      body:    JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Amazon Ads API POST ${path} failed: ${res.status} ${await res.text()}`)
    return res.json()
  }

  // ── Profiles ──────────────────────────────────────────────────────────────

  async getProfiles(): Promise<AmazonProfile[]> {
    return this.get<AmazonProfile[]>('/v2/profiles')
  }

  // ── SP Campaigns ──────────────────────────────────────────────────────────

  async getSpCampaigns(params?: Record<string, string>) {
    return this.get('/v2/sp/campaigns', params)
  }

  async getSpAdGroups(params?: Record<string, string>) {
    return this.get('/v2/sp/adGroups', params)
  }

  async getSpKeywords(params?: Record<string, string>) {
    return this.get('/v2/sp/keywords', params)
  }

  // ── SB Campaigns ──────────────────────────────────────────────────────────

  async getSbCampaigns(params?: Record<string, string>) {
    return this.get('/sb/campaigns', params)
  }

  async getSbKeywords(params?: Record<string, string>) {
    return this.get('/sb/keywords', params)
  }

  // ── Portfolios ────────────────────────────────────────────────────────────

  async getPortfolios() {
    return this.get('/v2/portfolios')
  }

  // ── Async Reporting API ───────────────────────────────────────────────────

  async createReport(body: ReportRequest): Promise<{ reportId: string }> {
    return this.post('/reporting/reports', body)
  }

  async getReportStatus(reportId: string): Promise<ReportStatusResponse> {
    return this.get(`/reporting/reports/${reportId}`)
  }

  async downloadReport(reportId: string): Promise<{ url: string }> {
    return this.get(`/reporting/reports/${reportId}/download`)
  }

  // Poll until report is ready, then return the download URL
  async waitForReport(reportId: string): Promise<string> {
    const timeout   = Date.now() + AMAZON_ADS_CONFIG.reportPollTimeoutMs
    const interval  = AMAZON_ADS_CONFIG.reportPollIntervalMs

    while (Date.now() < timeout) {
      const status = await this.getReportStatus(reportId)
      if (status.status === 'COMPLETED') {
        const { url } = await this.downloadReport(reportId)
        return url
      }
      if (status.status === 'FAILED') {
        throw new Error(`Report ${reportId} failed: ${status.statusDetails}`)
      }
      await new Promise(r => setTimeout(r, interval))
    }
    throw new Error(`Report ${reportId} timed out after ${AMAZON_ADS_CONFIG.reportPollTimeoutMs}ms`)
  }
}

// ── Report types ────────────────────────────────────────────────────────────

export interface ReportRequest {
  name:           string
  startDate:      string  // YYYY-MM-DD
  endDate:        string
  configuration: {
    adProduct:    'SPONSORED_PRODUCTS' | 'SPONSORED_BRANDS' | 'SPONSORED_DISPLAY'
    groupBy:      string[]
    columns:      string[]
    reportTypeId: string
    timeUnit:     'DAILY' | 'SUMMARY'
    format:       'GZIP_JSON'
  }
}

export interface ReportStatusResponse {
  reportId:      string
  status:        'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  statusDetails: string
  url?:          string
}

// ── Factory: get a client for a profile, auto-refreshing token if needed ────

export async function getClientForProfile(profileId: number): Promise<AmazonAdsClient> {
  const supabase = createServiceClient()

  const { data: profile, error } = await supabase
    .from('amazon_profiles')
    .select('*')
    .eq('profile_id', profileId)
    .single()

  if (error || !profile) throw new Error(`Profile ${profileId} not found`)

  let accessToken: string

  // Check if access token is still valid (with 60s buffer baked into tokenExpiresAt)
  const isExpired = !profile.token_expires_at || new Date(profile.token_expires_at) < new Date()

  if (isExpired) {
    const refreshToken = decryptToken(profile.refresh_token_enc)
    const tokens = await refreshAccessToken(refreshToken)

    accessToken = tokens.access_token
    const expiresAt = tokenExpiresAt(tokens.expires_in)

    // Persist refreshed token
    await supabase
      .from('amazon_profiles')
      .update({
        access_token_enc: encryptToken(tokens.access_token),
        token_expires_at: expiresAt.toISOString(),
      })
      .eq('profile_id', profileId)
  } else {
    accessToken = decryptToken(profile.access_token_enc)
  }

  return new AmazonAdsClient(accessToken, profileId)
}
