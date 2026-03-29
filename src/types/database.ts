// Auto-typed database schema for Supabase
// Reflects supabase/schema.sql exactly

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string
          plan: 'free' | 'pro' | 'agency'
          created_at: string
          settings: Json
        }
        Insert: {
          id: string
          email: string
          name: string
          plan?: 'free' | 'pro' | 'agency'
          created_at?: string
          settings?: Json
        }
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      amazon_profiles: {
        Row: {
          profile_id: number
          user_id: string
          marketplace: string
          account_name: string | null
          timezone: string
          access_token_enc: string
          refresh_token_enc: string
          token_expires_at: string | null
          last_sync_at: string | null
          sync_enabled: boolean
          created_at: string
        }
        Insert: {
          profile_id: number
          user_id: string
          marketplace: string
          account_name?: string | null
          timezone?: string
          access_token_enc: string
          refresh_token_enc: string
          token_expires_at?: string | null
          last_sync_at?: string | null
          sync_enabled?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['amazon_profiles']['Insert']>
      }
      sp_campaigns: {
        Row: {
          id: number
          profile_id: number
          campaign_id: number
          date: string
          campaign_name: string
          state: string
          daily_budget_cents: number | null
          bidding_strategy: string | null
          portfolio_id: number | null
          targeting_type: string | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sp_campaigns']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sp_campaigns']['Insert']>
      }
      sp_ad_groups: {
        Row: {
          id: number
          profile_id: number
          ad_group_id: number
          campaign_id: number
          date: string
          ad_group_name: string
          state: string
          default_bid_cents: number | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sp_ad_groups']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sp_ad_groups']['Insert']>
      }
      sp_keywords: {
        Row: {
          id: number
          profile_id: number
          keyword_id: number
          ad_group_id: number
          campaign_id: number
          date: string
          keyword_text: string
          match_type: string
          state: string
          bid_cents: number | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sp_keywords']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sp_keywords']['Insert']>
      }
      sp_search_terms: {
        Row: {
          id: number
          profile_id: number
          campaign_id: number
          ad_group_id: number
          date: string
          customer_search_term: string
          keyword_id: number | null
          match_type: string | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sp_search_terms']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sp_search_terms']['Insert']>
      }
      sp_product_targets: {
        Row: {
          id: number
          profile_id: number
          target_id: number
          ad_group_id: number
          campaign_id: number
          date: string
          target_expression: string
          state: string
          bid_cents: number | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sp_product_targets']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sp_product_targets']['Insert']>
      }
      sb_campaigns: {
        Row: {
          id: number
          profile_id: number
          campaign_id: number
          date: string
          campaign_name: string
          state: string
          daily_budget_cents: number | null
          portfolio_id: number | null
          ad_format: string | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          video_views: number
          video_view_rate: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sb_campaigns']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sb_campaigns']['Insert']>
      }
      sb_campaign_attribution: {
        Row: {
          id: number
          profile_id: number
          campaign_id: number
          date: string
          sales_cents: number
          orders: number
          source_report: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sb_campaign_attribution']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sb_campaign_attribution']['Insert']>
      }
      sb_keywords: {
        Row: {
          id: number
          profile_id: number
          keyword_id: number
          ad_group_id: number | null
          campaign_id: number
          date: string
          keyword_text: string
          match_type: string
          state: string
          bid_cents: number | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sb_keywords']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sb_keywords']['Insert']>
      }
      sb_search_terms: {
        Row: {
          id: number
          profile_id: number
          campaign_id: number
          ad_group_id: number | null
          date: string
          customer_search_term: string
          keyword_id: number | null
          match_type: string | null
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          units: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sb_search_terms']['Row'], 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sb_search_terms']['Insert']>
      }
      sync_logs: {
        Row: {
          id: number
          profile_id: number
          triggered_by: string
          status: 'running' | 'success' | 'failed' | 'partial'
          started_at: string
          completed_at: string | null
          records_upserted: number
          error_message: string | null
          date_range_start: string | null
          date_range_end: string | null
          metadata: Json
        }
        Insert: Omit<Database['public']['Tables']['sync_logs']['Row'], 'id'> & { id?: number }
        Update: Partial<Database['public']['Tables']['sync_logs']['Insert']>
      }
      alerts: {
        Row: {
          id: number
          profile_id: number
          alert_type: string
          severity: 'high' | 'medium' | 'low'
          entity_type: string
          entity_id: string
          entity_name: string
          message: string
          suggested_action: string | null
          triggered_at: string
          dismissed_at: string | null
          actioned_at: string | null
          dismiss_reason: string | null
        }
        Insert: Omit<Database['public']['Tables']['alerts']['Row'], 'id'> & { id?: number }
        Update: Partial<Database['public']['Tables']['alerts']['Insert']>
      }
    }
    Views: {
      mv_sp_campaigns_7d: {
        Row: {
          profile_id: number
          campaign_id: number
          campaign_name: string
          state: string
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          acos: number | null
          roas: number | null
          cpc_cents: number | null
          period_start: string
          period_end: string
        }
      }
      mv_sp_campaigns_30d: {
        Row: {
          profile_id: number
          campaign_id: number
          campaign_name: string
          state: string
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          acos: number | null
          roas: number | null
          cpc_cents: number | null
        }
      }
      mv_account_daily_summary: {
        Row: {
          profile_id: number
          date: string
          impressions: number
          clicks: number
          spend_cents: number
          sales_cents: number
          orders: number
          active_campaigns: number
        }
      }
    }
    Functions: {
      my_profile_ids: { Returns: number[] }
      refresh_materialized_views: { Returns: void }
    }
  }
}
