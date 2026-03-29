// GET /api/v1/campaigns?profile_id=xxx&days=30&type=SP|SB|SD&state=enabled
// Returns all campaigns with rolled-up metrics for the requested period

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const profileId = Number(searchParams.get('profile_id'))
  const days      = Math.min(Number(searchParams.get('days') ?? 30), 365)
  const type      = searchParams.get('type')   // SP | SB | null = both
  const state     = searchParams.get('state')  // enabled | paused | archived | null = all

  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString().split('T')[0]

  const fetchCampaigns = async (table: 'sp_campaigns' | 'sb_campaigns' | 'sd_campaigns', adType: string) => {
    let query = supabase
      .from(table)
      .select('campaign_id, campaign_name, state, daily_budget_cents, bidding_strategy, spend_cents, sales_cents, orders, impressions, clicks, units')
      .eq('profile_id', profileId)
      .gte('date', startStr)

    if (state) query = query.eq('state', state)

    const { data, error } = await query
    if (error) throw error

    // Group by campaign_id and aggregate
    const map = new Map<number, {
      campaign_id: number; campaign_name: string; state: string
      daily_budget_cents: number | null; bidding_strategy: string | null
      ad_type: string; spend_cents: number; sales_cents: number
      orders: number; impressions: number; clicks: number; units: number
    }>()

    for (const row of data ?? []) {
      if (!map.has(row.campaign_id)) {
        map.set(row.campaign_id, {
          campaign_id:        row.campaign_id,
          campaign_name:      row.campaign_name,
          state:              row.state,
          daily_budget_cents: row.daily_budget_cents,
          bidding_strategy:   row.bidding_strategy ?? null,
          ad_type:            adType,
          spend_cents: 0, sales_cents: 0, orders: 0,
          impressions: 0, clicks: 0, units: 0,
        })
      }
      const acc = map.get(row.campaign_id)!
      acc.spend_cents  += row.spend_cents
      acc.sales_cents  += row.sales_cents
      acc.orders       += row.orders
      acc.impressions  += row.impressions
      acc.clicks       += row.clicks
      acc.units        += row.units
    }

    return Array.from(map.values()).map(c => ({
      ...c,
      acos: c.sales_cents > 0 ? Math.round((c.spend_cents / c.sales_cents) * 10000) / 100 : null,
      roas: c.spend_cents > 0 ? Math.round((c.sales_cents / c.spend_cents) * 100) / 100 : null,
      cpc:  c.clicks > 0      ? Math.round(c.spend_cents / c.clicks) / 100 : null,
      ctr:  c.impressions > 0  ? Math.round((c.clicks / c.impressions) * 10000) / 100 : null,
      cvr:  c.clicks > 0      ? Math.round((c.orders / c.clicks) * 10000) / 100 : null,
      spend:  c.spend_cents  / 100,
      sales:  c.sales_cents  / 100,
    }))
  }

  try {
    const results = await Promise.all([
      ...((!type || type === 'SP') ? [fetchCampaigns('sp_campaigns', 'SP')] : []),
      ...((!type || type === 'SB') ? [fetchCampaigns('sb_campaigns', 'SB')] : []),
      ...((!type || type === 'SD') ? [fetchCampaigns('sd_campaigns', 'SD')] : []),
    ])

    const campaigns = results.flat().sort((a, b) => b.spend - a.spend)
    return NextResponse.json({ campaigns, count: campaigns.length })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
