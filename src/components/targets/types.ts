// Shared types for the merged Targets page (campaign → targets → search terms, A/B compare).

export type AB = {
  aSpend: number; aSales: number; aOrders: number; aClicks: number; aImp: number
  bSpend: number; bSales: number; bOrders: number; bClicks: number; bImp: number
}

export const zeroAB = (): AB => ({ aSpend: 0, aSales: 0, aOrders: 0, aClicks: 0, aImp: 0, bSpend: 0, bSales: 0, bOrders: 0, bClicks: 0, bImp: 0 })

export type BidPoint = { date: string; bidCents: number }

// Matches ChangeHistoryChart's ChangePoint shape
export type ChangePt = { ts: string; old_value: number | null; new_value: number | null }

export type ChangeChip = {
  id: number
  ts: string          // ISO timestamp of the change
  field: string       // BID_AMOUNT | PLACEMENT_GROUP | SMART_BIDDING_STRATEGY | BUDGET_AMOUNT | ...
  label: string       // precomputed display label, e.g. "Top of search 100%→180%"
}

export type TermItem = AB & {
  term: string
  matchType: string | null
  keywordId: string | null   // triggering target (max-spend keyword_id), null = unattributed
}

export type TargetItem = AB & {
  keywordId: string
  adType: 'SP' | 'SB'
  text: string
  matchType: string
  state: string
  targetType: 'keywords' | 'products' | 'auto'
  bidCents: number
  prevBidCents: number | null
  topIs: number | null
  bidHistory: BidPoint[]     // deduped change points from keyword_bid_history (≤40)
  bidEvents: ChangePt[]      // real-timestamp BID_AMOUNT events from change_events
  latestChip: ChangeChip | null
  searchTerms: TermItem[]
  omittedTermCount: number
}

export type PlacementInfo = AB & {
  key: 'top' | 'product' | 'rest'
  label: string
  currentPct: number | null
  events: ChangePt[]
}

export type CampaignGroup = AB & {
  id: string
  name: string
  adType: 'SP' | 'SB'
  state: string
  budgetCents: number
  strategy: string | null
  placements: PlacementInfo[]        // SP only; [] for SB
  targets: TargetItem[]
  unattributedTerms: TermItem[]
  omittedUnattributed: number
  changeChips: ChangeChip[]
}

export type NegRow = {
  key: string
  text: string
  matchType: string
  state: string
  level: string
  adTypeMark: string
  campaignName: string
}
