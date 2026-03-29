// GET /api/v1/metrics/summary?profile_id=xxx&days=30
// Returns blended totals: spend, sales, ACOS, ROAS, orders for a date range

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const profileId = Number(searchParams.get('profile_id'))
  const days      = Math.min(Number(searchParams.get('days') ?? 30), 365)

  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString().split('T')[0]

  // Fetch SP spend+sales, SB spend-side facts, and SB attribution-side facts separately.
  const [spResult, sbSpendResult, sbAttrResult] = await Promise.all([
    supabase
      .from('sp_campaigns')
      .select('spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId)
      .gte('date', startStr),
    supabase
      .from('sb_campaigns')
      .select('spend_cents, impressions, clicks')
      .eq('profile_id', profileId)
      .gte('date', startStr),
    supabase
      .from('sb_campaign_attribution')
      .select('sales_cents, orders')
      .eq('profile_id', profileId)
      .gte('date', startStr),
  ])

  if (spResult.error) return NextResponse.json({ error: spResult.error.message }, { status: 500 })
  if (sbSpendResult.error) return NextResponse.json({ error: sbSpendResult.error.message }, { status: 500 })
  if (sbAttrResult.error) return NextResponse.json({ error: sbAttrResult.error.message }, { status: 500 })

  const spTotals = (spResult.data ?? []).reduce((acc, row) => ({
    spend_cents: acc.spend_cents + row.spend_cents,
    sales_cents: acc.sales_cents + row.sales_cents,
    orders: acc.orders + row.orders,
    impressions: acc.impressions + row.impressions,
    clicks: acc.clicks + row.clicks,
  }), { spend_cents: 0, sales_cents: 0, orders: 0, impressions: 0, clicks: 0 })

  const sbSpendTotals = (sbSpendResult.data ?? []).reduce((acc, row) => ({
    spend_cents: acc.spend_cents + row.spend_cents,
    impressions: acc.impressions + row.impressions,
    clicks: acc.clicks + row.clicks,
  }), { spend_cents: 0, impressions: 0, clicks: 0 })

  const sbAttrTotals = (sbAttrResult.data ?? []).reduce((acc, row) => ({
    sales_cents: acc.sales_cents + row.sales_cents,
    orders: acc.orders + row.orders,
  }), { sales_cents: 0, orders: 0 })

  const totals = {
    spend_cents: spTotals.spend_cents + sbSpendTotals.spend_cents,
    sales_cents: spTotals.sales_cents + sbAttrTotals.sales_cents,
    orders: spTotals.orders + sbAttrTotals.orders,
    impressions: spTotals.impressions + sbSpendTotals.impressions,
    clicks: spTotals.clicks + sbSpendTotals.clicks,
  }

  const acos = totals.sales_cents > 0
    ? Math.round((totals.spend_cents / totals.sales_cents) * 10000) / 100
    : null

  const roas = totals.spend_cents > 0
    ? Math.round((totals.sales_cents / totals.spend_cents) * 100) / 100
    : null

  const cpc = totals.clicks > 0
    ? Math.round(totals.spend_cents / totals.clicks)
    : null

  const ctr = totals.impressions > 0
    ? Math.round((totals.clicks / totals.impressions) * 10000) / 100
    : null

  return NextResponse.json({
    profile_id:   profileId,
    days,
    start_date:   startStr,
    spend:        totals.spend_cents / 100,
    sales:        totals.sales_cents / 100,
    orders:       totals.orders,
    impressions:  totals.impressions,
    clicks:       totals.clicks,
    acos,
    roas,
    cpc:          cpc !== null ? cpc / 100 : null,
    ctr,
  })
}
