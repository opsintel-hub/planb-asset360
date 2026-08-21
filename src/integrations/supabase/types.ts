export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_contracts: {
        Row: {
          ad_contract: string | null
          asset_old_code: string | null
          brand: string | null
          brand_eng: string | null
          created_at: string
          end_date_contract: string | null
          equipment_id: string | null
          favor_end_date_contract: string | null
          favor_start_date_contract: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          package_code: string | null
          package_name: string | null
          payload: Json
          product_name: string | null
          source: string
          start_date_contract: string | null
          status: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          ad_contract?: string | null
          asset_old_code?: string | null
          brand?: string | null
          brand_eng?: string | null
          created_at?: string
          end_date_contract?: string | null
          equipment_id?: string | null
          favor_end_date_contract?: string | null
          favor_start_date_contract?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          package_code?: string | null
          package_name?: string | null
          payload?: Json
          product_name?: string | null
          source?: string
          start_date_contract?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          ad_contract?: string | null
          asset_old_code?: string | null
          brand?: string | null
          brand_eng?: string | null
          created_at?: string
          end_date_contract?: string | null
          equipment_id?: string | null
          favor_end_date_contract?: string | null
          favor_start_date_contract?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          package_code?: string | null
          package_name?: string | null
          payload?: Json
          product_name?: string | null
          source?: string
          start_date_contract?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      airtable_connections: {
        Row: {
          base_id: string | null
          enabled: boolean
          id: number
          last_synced_at: string | null
          name: string | null
          schedule: Json
          table_name: string | null
          updated_at: string
        }
        Insert: {
          base_id?: string | null
          enabled?: boolean
          id: number
          last_synced_at?: string | null
          name?: string | null
          schedule?: Json
          table_name?: string | null
          updated_at?: string
        }
        Update: {
          base_id?: string | null
          enabled?: boolean
          id?: number
          last_synced_at?: string | null
          name?: string | null
          schedule?: Json
          table_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      asset_pm_schedules: {
        Row: {
          asset_old_code: string | null
          asset_status: string | null
          id: string
          inform_position: string | null
          payload: Json
          project: string | null
          ref_number: string | null
          schedule_date: string | null
          status: string | null
          synced_at: string
        }
        Insert: {
          asset_old_code?: string | null
          asset_status?: string | null
          id?: string
          inform_position?: string | null
          payload?: Json
          project?: string | null
          ref_number?: string | null
          schedule_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Update: {
          asset_old_code?: string | null
          asset_status?: string | null
          id?: string
          inform_position?: string | null
          payload?: Json
          project?: string | null
          ref_number?: string | null
          schedule_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      asset_risk_scores: {
        Row: {
          asset_old_code: string
          claims_30d: number
          claims_365d: number
          claims_90d: number
          computed_at: string
          days_since_pm: number | null
          department: string | null
          district: string | null
          last_claim_at: string | null
          last_pm_at: string | null
          media_type: string | null
          open_claims: number
          risk_level: string
          score: number
          top_problem: string | null
          updated_at: string
        }
        Insert: {
          asset_old_code: string
          claims_30d?: number
          claims_365d?: number
          claims_90d?: number
          computed_at?: string
          days_since_pm?: number | null
          department?: string | null
          district?: string | null
          last_claim_at?: string | null
          last_pm_at?: string | null
          media_type?: string | null
          open_claims?: number
          risk_level?: string
          score?: number
          top_problem?: string | null
          updated_at?: string
        }
        Update: {
          asset_old_code?: string
          claims_30d?: number
          claims_365d?: number
          claims_90d?: number
          computed_at?: string
          days_since_pm?: number | null
          department?: string | null
          district?: string | null
          last_claim_at?: string | null
          last_pm_at?: string | null
          media_type?: string | null
          open_claims?: number
          risk_level?: string
          score?: number
          top_problem?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          area: string | null
          bkkupc: string | null
          created_at: string
          department: string | null
          district: string | null
          id: string
          installed_at: string | null
          last_claim_at: string | null
          last_history_synced_at: string | null
          last_monitor_ok_at: string | null
          last_pm_at: string | null
          latitude: number | null
          location: string | null
          longitude: number | null
          media_type: string | null
          name: string | null
          old_code: string
          payload: Json
          status: string | null
          territory: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          bkkupc?: string | null
          created_at?: string
          department?: string | null
          district?: string | null
          id?: string
          installed_at?: string | null
          last_claim_at?: string | null
          last_history_synced_at?: string | null
          last_monitor_ok_at?: string | null
          last_pm_at?: string | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          media_type?: string | null
          name?: string | null
          old_code: string
          payload?: Json
          status?: string | null
          territory?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          bkkupc?: string | null
          created_at?: string
          department?: string | null
          district?: string | null
          id?: string
          installed_at?: string | null
          last_claim_at?: string | null
          last_history_synced_at?: string | null
          last_monitor_ok_at?: string | null
          last_pm_at?: string | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          media_type?: string | null
          name?: string | null
          old_code?: string
          payload?: Json
          status?: string | null
          territory?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      billboard_mockups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          note: string | null
          old_code: string
          overlay: Json
          storage_path: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          note?: string | null
          old_code: string
          overlay?: Json
          storage_path: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          note?: string | null
          old_code?: string
          overlay?: Json
          storage_path?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      claim_next_steps: {
        Row: {
          created_at: string
          note: string
          ticket_code: string
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          created_at?: string
          note: string
          ticket_code: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          created_at?: string
          note?: string
          ticket_code?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_next_steps_ticket_fk"
            columns: ["ticket_code"]
            isOneToOne: true
            referencedRelation: "claim_tickets"
            referencedColumns: ["ref_number"]
          },
        ]
      }
      claim_tickets: {
        Row: {
          age_hours: number | null
          asset_old_code: string | null
          informed_detail: string | null
          location: string | null
          opened_at: string | null
          payload: Json
          ref_number: string
          severity: string | null
          sla_status: string | null
          status: string | null
          synced_at: string
          title: string | null
        }
        Insert: {
          age_hours?: number | null
          asset_old_code?: string | null
          informed_detail?: string | null
          location?: string | null
          opened_at?: string | null
          payload?: Json
          ref_number: string
          severity?: string | null
          sla_status?: string | null
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Update: {
          age_hours?: number | null
          asset_old_code?: string | null
          informed_detail?: string | null
          location?: string | null
          opened_at?: string | null
          payload?: Json
          ref_number?: string
          severity?: string | null
          sla_status?: string | null
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: []
      }
      claims: {
        Row: {
          age_hours: number | null
          asset_id: string | null
          asset_old_code: string | null
          id: string
          opened_at: string | null
          payload: Json
          severity: string | null
          sla_status: string | null
          synced_at: string
          ticket_code: string
          title: string | null
        }
        Insert: {
          age_hours?: number | null
          asset_id?: string | null
          asset_old_code?: string | null
          id?: string
          opened_at?: string | null
          payload?: Json
          severity?: string | null
          sla_status?: string | null
          synced_at?: string
          ticket_code: string
          title?: string | null
        }
        Update: {
          age_hours?: number | null
          asset_id?: string | null
          asset_old_code?: string | null
          id?: string
          opened_at?: string | null
          payload?: Json
          severity?: string | null
          sla_status?: string | null
          synced_at?: string
          ticket_code?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      diagram_mappings: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          icon: string | null
          id: string
          keywords: string[]
          label: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          enabled?: boolean
          icon?: string | null
          id?: string
          keywords?: string[]
          label: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          icon?: string | null
          id?: string
          keywords?: string[]
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      informed_mapping: {
        Row: {
          created_at: string
          id: string
          impact_level: string
          informed: string
          informed_detail: string
          informed_group: string | null
          team: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          impact_level: string
          informed: string
          informed_detail: string
          informed_group?: string | null
          team?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          impact_level?: string
          informed?: string
          informed_detail?: string
          informed_group?: string | null
          team?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      map_saved_locations: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_shared: boolean
          lat: number
          lng: number
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_shared?: boolean
          lat: number
          lng: number
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_shared?: boolean
          lat?: number
          lng?: number
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      map_saved_routes: {
        Row: {
          created_at: string
          id: string
          is_shared: boolean
          kind: string
          name: string
          notes: string | null
          origin: Json | null
          radius_m: number
          road_polyline: Json | null
          updated_at: string
          user_id: string
          waypoints: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_shared?: boolean
          kind?: string
          name: string
          notes?: string | null
          origin?: Json | null
          radius_m?: number
          road_polyline?: Json | null
          updated_at?: string
          user_id: string
          waypoints?: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_shared?: boolean
          kind?: string
          name?: string
          notes?: string | null
          origin?: Json | null
          radius_m?: number
          road_polyline?: Json | null
          updated_at?: string
          user_id?: string
          waypoints?: Json
        }
        Relationships: []
      }
      monitoring_status: {
        Row: {
          asset_id: string
          asset_old_code: string | null
          error_code: string | null
          last_seen_at: string | null
          message: string | null
          online: boolean
          updated_at: string
          uptime_7d: number | null
        }
        Insert: {
          asset_id: string
          asset_old_code?: string | null
          error_code?: string | null
          last_seen_at?: string | null
          message?: string | null
          online?: boolean
          updated_at?: string
          uptime_7d?: number | null
        }
        Update: {
          asset_id?: string
          asset_old_code?: string | null
          error_code?: string | null
          last_seen_at?: string | null
          message?: string | null
          online?: boolean
          updated_at?: string
          uptime_7d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_status_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      mssql_asset_history: {
        Row: {
          asset_status: string | null
          bkk_upc: string | null
          category: string | null
          created_date: string | null
          id: string
          inform_detail: string | null
          inform_position: string | null
          media_type: string | null
          old_code: string | null
          problem_category: string | null
          problem_detail: string | null
          problem_equipment: string | null
          project: string | null
          ref_number: string | null
          resolve_time: number | null
          response_time: number | null
          solution_category: string | null
          solution_detail: string | null
          status: string | null
          synced_at: string
          total_turnaround_time: number | null
          updated_date: string | null
        }
        Insert: {
          asset_status?: string | null
          bkk_upc?: string | null
          category?: string | null
          created_date?: string | null
          id?: string
          inform_detail?: string | null
          inform_position?: string | null
          media_type?: string | null
          old_code?: string | null
          problem_category?: string | null
          problem_detail?: string | null
          problem_equipment?: string | null
          project?: string | null
          ref_number?: string | null
          resolve_time?: number | null
          response_time?: number | null
          solution_category?: string | null
          solution_detail?: string | null
          status?: string | null
          synced_at?: string
          total_turnaround_time?: number | null
          updated_date?: string | null
        }
        Update: {
          asset_status?: string | null
          bkk_upc?: string | null
          category?: string | null
          created_date?: string | null
          id?: string
          inform_detail?: string | null
          inform_position?: string | null
          media_type?: string | null
          old_code?: string | null
          problem_category?: string | null
          problem_detail?: string | null
          problem_equipment?: string | null
          project?: string | null
          ref_number?: string | null
          resolve_time?: number | null
          response_time?: number | null
          solution_category?: string | null
          solution_detail?: string | null
          status?: string | null
          synced_at?: string
          total_turnaround_time?: number | null
          updated_date?: string | null
        }
        Relationships: []
      }
      mv_pm_claim_pairs: {
        Row: {
          asset_old_code: string | null
          claim_ref: string | null
          claim_ts: string | null
          days: number | null
          department: string | null
          media_type: string | null
          pm_category: string | null
          pm_end_ts: string | null
          pm_ref: string | null
          problem_category: string | null
          problem_detail: string | null
          problem_equipment: string | null
          project: string | null
          solution_category: string | null
          solution_detail: string | null
          zone: string | null
        }
        Insert: {
          asset_old_code?: string | null
          claim_ref?: string | null
          claim_ts?: string | null
          days?: number | null
          department?: string | null
          media_type?: string | null
          pm_category?: string | null
          pm_end_ts?: string | null
          pm_ref?: string | null
          problem_category?: string | null
          problem_detail?: string | null
          problem_equipment?: string | null
          project?: string | null
          solution_category?: string | null
          solution_detail?: string | null
          zone?: string | null
        }
        Update: {
          asset_old_code?: string | null
          claim_ref?: string | null
          claim_ts?: string | null
          days?: number | null
          department?: string | null
          media_type?: string | null
          pm_category?: string | null
          pm_end_ts?: string | null
          pm_ref?: string | null
          problem_category?: string | null
          problem_detail?: string | null
          problem_equipment?: string | null
          project?: string | null
          solution_category?: string | null
          solution_detail?: string | null
          zone?: string | null
        }
        Relationships: []
      }
      mv_pm_history: {
        Row: {
          asset_department: string | null
          asset_media_type: string | null
          asset_old_code: string | null
          asset_status: string | null
          bkk_upc: string | null
          category: string | null
          created_at: string | null
          event_ts: string | null
          media_type: string | null
          problem_category: string | null
          problem_detail: string | null
          problem_equipment: string | null
          project: string | null
          ref_number: string | null
          solution_category: string | null
          solution_detail: string | null
          status: string | null
          total_turnaround_time: number | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          asset_department?: string | null
          asset_media_type?: string | null
          asset_old_code?: string | null
          asset_status?: string | null
          bkk_upc?: string | null
          category?: string | null
          created_at?: string | null
          event_ts?: string | null
          media_type?: string | null
          problem_category?: string | null
          problem_detail?: string | null
          problem_equipment?: string | null
          project?: string | null
          ref_number?: string | null
          solution_category?: string | null
          solution_detail?: string | null
          status?: string | null
          total_turnaround_time?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_department?: string | null
          asset_media_type?: string | null
          asset_old_code?: string | null
          asset_status?: string | null
          bkk_upc?: string | null
          category?: string | null
          created_at?: string | null
          event_ts?: string | null
          media_type?: string | null
          problem_category?: string | null
          problem_detail?: string | null
          problem_equipment?: string | null
          project?: string | null
          ref_number?: string | null
          solution_category?: string | null
          solution_detail?: string | null
          status?: string | null
          total_turnaround_time?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      poi_shares: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          payload: Json
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          payload: Json
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          payload?: Json
          token?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      route_deferred_assets: {
        Row: {
          asset_old_code: string
          cleared_at: string | null
          created_by: string
          day_index: number | null
          deferred_at: string
          id: string
          inspector_index: number | null
          inspector_name: string | null
          plan_name: string | null
          reason: string | null
          risk_level: string | null
        }
        Insert: {
          asset_old_code: string
          cleared_at?: string | null
          created_by?: string
          day_index?: number | null
          deferred_at?: string
          id?: string
          inspector_index?: number | null
          inspector_name?: string | null
          plan_name?: string | null
          reason?: string | null
          risk_level?: string | null
        }
        Update: {
          asset_old_code?: string
          cleared_at?: string | null
          created_by?: string
          day_index?: number | null
          deferred_at?: string
          id?: string
          inspector_index?: number | null
          inspector_name?: string | null
          plan_name?: string | null
          reason?: string | null
          risk_level?: string | null
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          finished_at: string | null
          id: number
          message: string | null
          rows_affected: number | null
          source: string
          started_at: string
          status: string
        }
        Insert: {
          finished_at?: string | null
          id?: number
          message?: string | null
          rows_affected?: number | null
          source: string
          started_at?: string
          status: string
        }
        Update: {
          finished_at?: string | null
          id?: number
          message?: string | null
          rows_affected?: number | null
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      ad_current_by_asset: {
        Row: {
          ad_contract: string | null
          asset_old_code: string | null
          brand: string | null
          brand_eng: string | null
          days_to_end: number | null
          end_date_contract: string | null
          equipment_id: string | null
          favor_end_date_contract: string | null
          favor_start_date_contract: string | null
          package_code: string | null
          package_name: string | null
          product_name: string | null
          start_date_contract: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_mssql_cron_schedules: {
        Args: never
        Returns: {
          job_name: string
          schedule: string
        }[]
      }
      get_poi_share: {
        Args: { _token: string }
        Returns: {
          created_at: string
          expires_at: string
          payload: Json
        }[]
      }
      get_public_schema_info: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recompute_asset_risk_scores: { Args: never; Returns: number }
      refresh_pm_views: { Args: never; Returns: undefined }
      set_mssql_cron_schedule: {
        Args: { p_hour_utc: number; p_job: string; p_minute_utc: number }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "technician"
        | "viewer"
        | "sale"
        | "crm"
        | "production"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "technician",
        "viewer",
        "sale",
        "crm",
        "production",
      ],
    },
  },
} as const
