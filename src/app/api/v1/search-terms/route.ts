// GET /api/v1/search-terms?profile_id=xxx&days=30&mode=wasted|converters|all
// Returns search term performance data

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const profileId         = Number(searchParams.get('profile_id'))
  const days              = Math.min(Number(searchParams.get('days') ?? 14), 90)
  const mode              = searchParams.get('mode') ?? 'all'  // all | wasted | converters
  const wastedThresholdCents = Number(searchParams.get('min_spend') ?? 5) * 100
  const converterAcosMax  = Number(searchParams.get('acos_max') ?? 15)

  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString().split('T')[0]

  // Aggregate search terms across all campaigns in the period
  const { data: rows, error } = await supabase
    .from('sp_search_terms')
    .select('customer_search_term, campaign_id, ad_group_id, impressions, clicks, spend_cents, sales_cents, orders')
    .eq('profile_id', profileId)
    .gte('date', startStr)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate by search term
  const map = new Map<string, {
    term: string; impressions: number; clicks: number
    spend_cents: number; sales_cents: number; orders: number
  }>()

  for (const row of rows ?? []) {
    const key = row.customer_search_term
    if (!map.has(key)) {
      map.set(key, { term: key, impressions: 0, clicks: 0, spend_cents: 0, sales_cents: 0, orders: 0 })
    }
    const acc = map.get(key)!
    acc.impressions += row.impressions
    acc.clicks      += row.clicks
    acc.spend_cents += row.spend_cents
    acc.sales_cents += row.sales_cents
    acc.orders      += row.orders
  }

  let terms = Array.from(map.values()).map(t => ({
    term:       t.term,
    impressions: t.impressions,
    clicks:      t.clicks,
    spend:       t.spend_cents / 100,
    sales:       t.sales_cents / 100,
    orders:      t.orders,
    acos:        t.sales_cents > 0 ? Math.round((t.spend_cents / t.sales_cents) * 10000) / 100 : null,
    roas:        t.spend_cents > 0 ? Math.round((t.sales_cents / t.spend_cents) * 100) / 100 : null,
    cpc:         t.clicks > 0      ? Math.round(t.spend_cents / t.clicks) / 100 : null,
    cvr:         t.clicks > 0      ? Math.round((t.orders / t.clicks) * 10000) / 100 : null,
  }))

  // Filter by mode
  if (mode === 'wasted') {
    terms = terms.filter(t => t.sales === 0 && t.spend * 100 >= wastedThresholdCents)
    terms.sort((a, b) => b.spend - a.spend)
  } else if (mode === 'converters') {
    terms = terms.filter(t => t.orders >= 2 && t.acos !== null && t.acos <= converterAcosMax)
    terms.sort((a, b) => b.orders - a.orders)
  } else {
    terms.sort((a, b) => b.spend - a.spend)
  }

  const totalWastedSpend = mode === 'wasted'
    ? terms.reduce((sum, t) => sum + t.spend, 0)
    : undefined

  return NextResponse.json({
    terms,
    count:             terms.length,
    total_wasted_spend: totalWastedSpend,
  })
}
