// ============================================================================
// history_probe.mjs — Amazon Change History API (POST /history) diagnostic probe
// ----------------------------------------------------------------------------
// Reproduces sync-profile.syncChangeHistory() locally so we can capture the
// Amazon x-amzn-RequestId for a /history call — the value Amazon Support needs
// to investigate empty-200 (totalRecords:0) responses. See brain/decisions D-017.
//
// Reads credentials from ../.env.local (gitignored). Prints NO secrets.
//
// Usage:
//   node scripts/history_probe.mjs [PROFILE_ID] [FROM_YYYY-MM-DD] [TO_YYYY-MM-DD]
// Examples:
//   node scripts/history_probe.mjs
//   node scripts/history_probe.mjs 1767117457704918 2026-04-02 2026-07-01
//
// Defaults: US profile 1767117457704918, last ~89 days.
// ============================================================================
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '..', '.env.local')

const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}

const SUPABASE_URL  = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = env.SUPABASE_SERVICE_ROLE_KEY
const ENC_KEY       = env.TOKEN_ENCRYPTION_KEY
const CLIENT_ID     = env.AMAZON_LWA_CLIENT_ID
const CLIENT_SECRET = env.AMAZON_LWA_CLIENT_SECRET
const ADS_BASE      = 'https://advertising-api.amazon.com'

// ── CLI args ────────────────────────────────────────────────────────────────
const PROFILE_ID = process.argv[2] || '1767117457704918' // US default
function msFromArg(arg, fallbackMs) {
  if (!arg) return fallbackMs
  const [y, mo, d] = arg.split('-').map(Number)
  return Date.UTC(y, mo - 1, d)
}
const nowMs  = Date.now()
const fromMs = msFromArg(process.argv[3], nowMs - (89 * 24 * 60 * 60 * 1000))
const toMs   = msFromArg(process.argv[4], nowMs)

// ── Crypto (mirrors sync-profile decryptToken: AES-256-GCM, iv+tag+cipher hex) ─
function decryptToken(enc) {
  const iv     = Buffer.from(enc.slice(0, 24), 'hex')
  const tag    = Buffer.from(enc.slice(24, 56), 'hex')
  const cipher = Buffer.from(enc.slice(56), 'hex')
  const key    = Buffer.from(ENC_KEY, 'hex')
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(cipher), d.final()]).toString('utf8')
}

// 1. Fetch encrypted refresh token from Supabase
const profRes = await fetch(`${SUPABASE_URL}/rest/v1/amazon_profiles?profile_id=eq.${PROFILE_ID}&select=profile_id,refresh_token_enc`, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
})
const profs = await profRes.json()
if (!Array.isArray(profs) || !profs.length) { console.error('Profile not found:', JSON.stringify(profs)); process.exit(1) }
console.log('Profile found:', profs[0].profile_id)

// 2. Decrypt refresh token + exchange for a fresh access token
const rt = decryptToken(profs[0].refresh_token_enc)
const tokRes = await fetch('https://api.amazon.com/auth/o2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
})
if (!tokRes.ok) { console.error('Token refresh failed:', tokRes.status, await tokRes.text()); process.exit(1) }
const accessToken = (await tokRes.json()).access_token
console.log('Access token refreshed OK (len ' + accessToken.length + ')')

// 3. Call /history exactly like production (same eventTypes/filters/headers).
// `parents` is REQUIRED — without it the API returns 200/totalRecords:0 (Amazon Support, 2026-07-01).
const PARENTS = [{ useProfileIdAdvertiser: true }]
const body = {
  eventTypes: {
    CAMPAIGN:          { filters: ['STATUS','IN_BUDGET','BUDGET_AMOUNT','NAME','START_DATE','END_DATE','SMART_BIDDING_STRATEGY','PLACEMENT_GROUP'], parents: PARENTS },
    AD_GROUP:          { filters: ['STATUS','NAME','BID_AMOUNT'], parents: PARENTS },
    KEYWORD:           { filters: ['STATUS','BID_AMOUNT'], parents: PARENTS },
    PRODUCT_TARGETING: { filters: ['STATUS','BID_AMOUNT'], parents: PARENTS },
    NEGATIVE_KEYWORD:  { filters: ['STATUS'], parents: PARENTS },
    AD:                { filters: ['STATUS'], parents: PARENTS },
  },
  fromDate: fromMs, toDate: toMs, count: 200, pageOffset: 0, sort: { direction: 'ASC', key: 'DATE' },
}
const reqTime = new Date().toISOString()
const histRes = await fetch(`${ADS_BASE}/history`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': CLIENT_ID,
    'Amazon-Advertising-API-Scope': PROFILE_ID,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.historyresponse.v1.1+json',
  },
  body: JSON.stringify(body),
})
const reqId = histRes.headers.get('x-amzn-RequestId') || histRes.headers.get('x-amz-request-id')
const text = await histRes.text()
let parsed = null; try { parsed = JSON.parse(text) } catch {}

console.log('\n================ /history RESULT ================')
console.log('Profile ID        :', PROFILE_ID)
console.log('Request time (UTC):', reqTime)
console.log('fromDate (ms,date):', fromMs, new Date(fromMs).toISOString().slice(0, 10))
console.log('toDate   (ms,date):', toMs, new Date(toMs).toISOString().slice(0, 10))
console.log('HTTP status       :', histRes.status)
console.log('x-amzn-RequestId  :', reqId)
console.log('totalRecords      :', parsed?.totalRecords ?? parsed?.totalResults ?? '(none)')
console.log('events returned   :', Array.isArray(parsed?.events) ? parsed.events.length : '(none)')
console.log('raw body (first 600):', text.slice(0, 600))
console.log('================================================')
