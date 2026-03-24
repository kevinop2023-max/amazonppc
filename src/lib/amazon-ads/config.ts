// Amazon Ads API + LWA configuration

export const AMAZON_ADS_CONFIG = {
  // API base URLs by region
  apiBaseUrl: {
    NA: 'https://advertising-api.amazon.com',
    EU: 'https://advertising-api-eu.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com',
  },

  // LWA (Login with Amazon) OAuth endpoints
  lwaTokenUrl: 'https://api.amazon.com/auth/o2/token',
  lwaAuthUrl:  'https://www.amazon.com/ap/oa',

  // Required OAuth scope for Amazon Ads API
  scope: 'advertising::campaign_management',

  // Default region
  defaultRegion: 'NA' as 'NA' | 'EU' | 'FE',

  // API rate limits (requests per second per profile)
  rateLimitPerSecond: 1,

  // Report polling interval in ms
  reportPollIntervalMs: 5_000,
  reportPollTimeoutMs: 300_000, // 5 minutes
} as const

export const LWA_CLIENT_ID     = process.env.AMAZON_LWA_CLIENT_ID!
export const LWA_CLIENT_SECRET = process.env.AMAZON_LWA_CLIENT_SECRET!
export const APP_REDIRECT_URI  = process.env.AMAZON_REDIRECT_URI!
export const TOKEN_ENCRYPT_KEY = process.env.TOKEN_ENCRYPTION_KEY!  // 32-byte hex string
