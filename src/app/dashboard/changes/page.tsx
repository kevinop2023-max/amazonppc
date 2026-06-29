import { createClient } from '@/lib/supabase/server'
import ChangesView, { type ChangeEvent } from '@/components/ChangesView'

export const revalidate = 0

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: { profile_id?: string }
}) {
  const supabase = await createClient()

  const { data: profiles } = await supabase.from('amazon_profiles')
    .select('profile_id, account_name, marketplace').order('created_at').limit(10)
  const usProfile = profiles?.find(p => p.marketplace === 'ATVPDKIKX0DER')
  const profileId = searchParams.profile_id ? Number(searchParams.profile_id) : (usProfile ?? profiles?.[0])?.profile_id ?? null

  let events: ChangeEvent[] = []
  let source: 'api' | 'snapshot' | 'mixed' = 'snapshot'

  if (profileId) {
    const [{ data: raw }, { data: spCamp }, { data: sbCamp }, { data: sdCamp }, { data: kbh }, { data: ag }] = await Promise.all([
      supabase.from('change_events')
        .select('id, entity_type, entity_id, campaign_id, field, old_value, new_value, old_text, new_text, event_ts, ad_type, source')
        .eq('profile_id', profileId).order('event_ts', { ascending: false }).range(0, 49999),
      supabase.from('sp_campaigns').select('campaign_id, campaign_name').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
      supabase.from('sb_campaigns').select('campaign_id, campaign_name').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
      supabase.from('sd_campaigns').select('campaign_id, campaign_name').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
      supabase.from('keyword_bid_history').select('keyword_id, keyword_text, match_type').eq('profile_id', profileId).range(0, 49999),
      supabase.from('sp_ad_groups').select('ad_group_id, ad_group_name').eq('profile_id', profileId).order('date', { ascending: false }).range(0, 49999),
    ])

    const campName = new Map<string, string>()
    for (const c of [...(spCamp ?? []), ...(sbCamp ?? []), ...(sdCamp ?? [])]) {
      const k = String(c.campaign_id)
      if (!campName.has(k) && c.campaign_name) campName.set(k, c.campaign_name)
    }
    const kwName = new Map<string, string>()
    for (const k of kbh ?? []) {
      const key = String(k.keyword_id)
      if (!kwName.has(key)) kwName.set(key, k.match_type ? `${k.keyword_text} (${k.match_type})` : k.keyword_text)
    }
    const agName = new Map<string, string>()
    for (const a of ag ?? []) {
      const key = String(a.ad_group_id)
      if (!agName.has(key) && a.ad_group_name) agName.set(key, a.ad_group_name)
    }

    const nameFor = (e: any): string => {
      if (e.entity_type === 'CAMPAIGN') return campName.get(e.entity_id) ?? `Campaign ${e.entity_id}`
      if (e.entity_type === 'KEYWORD' || e.entity_type === 'PRODUCT_TARGETING') return kwName.get(e.entity_id) ?? `${e.entity_type === 'KEYWORD' ? 'Keyword' : 'Target'} ${e.entity_id}`
      if (e.entity_type === 'AD_GROUP') return agName.get(e.entity_id) ?? `Ad group ${e.entity_id}`
      return `${e.entity_type} ${e.entity_id}`
    }

    events = (raw ?? []).map((e: any): ChangeEvent => ({
      id: e.id,
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      campaign_id: e.campaign_id,
      field: e.field,
      old_value: e.old_value == null ? null : Number(e.old_value),
      new_value: e.new_value == null ? null : Number(e.new_value),
      old_text: e.old_text,
      new_text: e.new_text,
      event_ts: e.event_ts,
      ad_type: e.ad_type,
      source: e.source,
      entityName: nameFor(e),
      campaignName: e.campaign_id ? (campName.get(e.campaign_id) ?? null) : null,
    }))

    const srcs = new Set(events.map(e => e.source))
    source = srcs.size > 1 ? 'mixed' : (srcs.has('api') ? 'api' : 'snapshot')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Change History</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Every bid, budget, placement, strategy and status change — {events.length} recorded
        </p>
      </div>
      <ChangesView events={events} source={source} />
    </div>
  )
}
