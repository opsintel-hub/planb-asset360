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
      asset_history: {
        Row: {
          asset_id: string | null
          asset_old_code: string | null
          closed_at: string | null
          created_at: string
          id: string
          opened_at: string | null
          payload: Json
          sla_hours: number | null
          status: string | null
          ticket_code: string | null
          title: string | null
          type: string
        }
        Insert: {
          asset_id?: string | null
          asset_old_code?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          opened_at?: string | null
          payload?: Json
          sla_hours?: number | null
          status?: string | null
          ticket_code?: string | null
          title?: string | null
          type: string
        }
        Update: {
          asset_id?: string | null
          asset_old_code?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          opened_at?: string | null
          payload?: Json
          sla_hours?: number | null
          status?: string | null
          ticket_code?: string | null
          title?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
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
      assets: {
        Row: {
          area: string | null
          created_at: string
          department: string | null
          id: string
          installed_at: string | null
          last_claim_at: string | null
          last_history_synced_at: string | null
          last_monitor_ok_at: string | null
          last_pm_at: string | null
          latitude: number | null
          longitude: number | null
          name: string | null
          old_code: string
          payload: Json
          status: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          department?: string | null
          id?: string
          installed_at?: string | null
          last_claim_at?: string | null
          last_history_synced_at?: string | null
          last_monitor_ok_at?: string | null
          last_pm_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          old_code: string
          payload?: Json
          status?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          created_at?: string
          department?: string | null
          id?: string
          installed_at?: string | null
          last_claim_at?: string | null
          last_history_synced_at?: string | null
          last_monitor_ok_at?: string | null
          last_pm_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          old_code?: string
          payload?: Json
          status?: string | null
          updated_at?: string
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
          action: string | null
          action_date: string | null
          asset_old_code: string | null
          id: string
          payload: Json
          project: string | null
          ref_number: string | null
          status: string | null
          synced_at: string
        }
        Insert: {
          action?: string | null
          action_date?: string | null
          asset_old_code?: string | null
          id?: string
          payload?: Json
          project?: string | null
          ref_number?: string | null
          status?: string | null
          synced_at?: string
        }
        Update: {
          action?: string | null
          action_date?: string | null
          asset_old_code?: string | null
          id?: string
          payload?: Json
          project?: string | null
          ref_number?: string | null
          status?: string | null
          synced_at?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "technician" | "viewer" | "sale"
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
      app_role: ["admin", "manager", "technician", "viewer", "sale"],
    },
  },
} as const
