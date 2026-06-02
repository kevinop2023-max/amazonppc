'use server'
import { createClient } from '@/lib/supabase/server'

export async function getBidHistory(keywordId: number, adType: 'sp' | 'sb') {
  const supabase = await createClient()
  const { data } = await supabase
    .from('keyword_bid_history')
    .select('bid_cents, recorded_date')
    .eq('keyword_id', keywordId)
    .eq('ad_type', adType)
    .order('recorded_date', { ascending: true })
    .limit(90)
  return (data ?? []).map(r => ({ date: r.recorded_date, bid: r.bid_cents / 100 }))
}
