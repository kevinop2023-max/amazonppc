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

  // Fetch SP + SB combined totals
  const [spResult, sbResult] = await Promise.all([
    supabase
      .from('sp_campaigns')
      .select('spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId)
      .gte('date', startStr),
    supabase
      .from('sb_campaigns')
      .select('spend_cents, sales_cents, orders, impressions, clicks')
      .eq('profile_id', profileId)
      .gte('date', startStr),
  ])

  if (spResult.error) return NextResponse.json({ error: spResult.error.message }, { status: 500 })
  if (sbResult.error) return NextResponse.json({ error: sbResult.error.message }, { status: 500 })

  const allRows = [...(spResult.data ?? []), ...(sbResult.data ?? [])]

  const totals = allRows.reduce((acc, row) => ({
    spend_cents:  acc.spend_cents  + row.spend_cents,
    sales_cents:  acc.sales_cents  + row.sales_cents,
    orders:       acc.orders       + row.orders,
    impressions:  acc.impressions  + row.impressions,
    clicks:       acc.clicks       + row.clicks,
  }), { spend_cents: 0, sales_cents: 0, orders: 0, impressions: 0, clicks: 0 })

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
