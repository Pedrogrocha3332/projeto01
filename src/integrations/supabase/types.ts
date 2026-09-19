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
      analytics_snapshots: {
        Row: {
          captured_at: string
          id: string
          ig_account_id: string
          ig_media_id: string | null
          metrics: Json
          scope: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          id?: string
          ig_account_id: string
          ig_media_id?: string | null
          metrics?: Json
          scope: string
          user_id: string
        }
        Update: {
          captured_at?: string
          id?: string
          ig_account_id?: string
          ig_media_id?: string | null
          metrics?: Json
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_snapshots_ig_account_id_fkey"
            columns: ["ig_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_healing_log: {
        Row: {
          action: string
          category: string | null
          created_at: string
          error: string | null
          id: string
          ig_account_id: string | null
          metadata: Json
          new_scheduled_at: string | null
          original_scheduled_at: string | null
          post_id: string | null
          reason: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          category?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ig_account_id?: string | null
          metadata?: Json
          new_scheduled_at?: string | null
          original_scheduled_at?: string | null
          post_id?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          category?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ig_account_id?: string | null
          metadata?: Json
          new_scheduled_at?: string | null
          original_scheduled_at?: string | null
          post_id?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_healing_log_ig_account_id_fkey"
            columns: ["ig_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_healing_log_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "scheduled_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      caption_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hashtag_groups: {
        Row: {
          created_at: string
          hashtags: string[]
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hashtags?: string[]
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hashtags?: string[]
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          access_token: string
          account_type: string | null
          created_at: string
          followers_count: number | null
          id: string
          ig_user_id: string
          is_active: boolean
          is_restricted: boolean
          manual_review_at: string | null
          manual_review_reason: string | null
          media_count: number | null
          needs_manual_review: boolean
          page_id: string | null
          page_name: string | null
          profile_picture_url: string | null
          restricted_at: string | null
          restricted_reason: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          access_token: string
          account_type?: string | null
          created_at?: string
          followers_count?: number | null
          id?: string
          ig_user_id: string
          is_active?: boolean
          is_restricted?: boolean
          manual_review_at?: string | null
          manual_review_reason?: string | null
          media_count?: number | null
          needs_manual_review?: boolean
          page_id?: string | null
          page_name?: string | null
          profile_picture_url?: string | null
          restricted_at?: string | null
          restricted_reason?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          access_token?: string
          account_type?: string | null
          created_at?: string
          followers_count?: number | null
          id?: string
          ig_user_id?: string
          is_active?: boolean
          is_restricted?: boolean
          manual_review_at?: string | null
          manual_review_reason?: string | null
          media_count?: number | null
          needs_manual_review?: boolean
          page_id?: string | null
          page_name?: string | null
          profile_picture_url?: string | null
          restricted_at?: string | null
          restricted_reason?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          created_at: string
          created_by: string
          email_hint: string | null
          expires_at: string
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          email_hint?: string | null
          expires_at: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          email_hint?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          folder_id: string | null
          ig_account_id: string | null
          created_at: string
          duration_seconds: number | null
          file_name: string
          height: number | null
          id: string
          media_kind: string
          mime_type: string
          public_url: string
          size_bytes: number
          storage_path: string
          tags: string[]
          thumbnail_path: string | null
          thumbnail_url: string | null
          user_id: string
          width: number | null
        }
        Insert: {
          folder_id?: string | null
          ig_account_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_name: string
          height?: number | null
          id?: string
          media_kind: string
          mime_type: string
          public_url: string
          size_bytes?: number
          storage_path: string
          tags?: string[]
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          user_id: string
          width?: number | null
        }
        Update: {
          folder_id?: string | null
          ig_account_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_name?: string
          height?: number | null
          id?: string
          media_kind?: string
          mime_type?: string
          public_url?: string
          size_bytes?: number
          storage_path?: string
          tags?: string[]
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          user_id?: string
          width?: number | null
        }
        Relationships: []
      }
      media_pools: {
        Row: {
          manual_order: boolean
          batch_size: number
          batches_published: number
          caption: string
          cover_media_asset_id: string | null
          created_at: string
          cycle_number: number
          id: string
          ig_account_id: string
          interval_minutes: number
          last_batch_at: string | null
          name: string
          next_batch_at: string | null
          reels_published: number
          spacing_seconds: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          manual_order?: boolean
          batch_size?: number
          batches_published?: number
          caption?: string
          cover_media_asset_id?: string | null
          created_at?: string
          cycle_number?: number
          id?: string
          ig_account_id: string
          interval_minutes?: number
          last_batch_at?: string | null
          name: string
          next_batch_at?: string | null
          reels_published?: number
          spacing_seconds?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          manual_order?: boolean
          batch_size?: number
          batches_published?: number
          caption?: string
          cover_media_asset_id?: string | null
          created_at?: string
          cycle_number?: number
          id?: string
          ig_account_id?: string
          interval_minutes?: number
          last_batch_at?: string | null
          name?: string
          next_batch_at?: string | null
          reels_published?: number
          spacing_seconds?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_pools_cover_media_asset_id_fkey"
            columns: ["cover_media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_pools_ig_account_id_fkey"
            columns: ["ig_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_credentials: {
        Row: {
          app_id: string
          app_secret: string
          created_at: string
          id: string
          last_test_error: string | null
          last_test_status: string | null
          last_tested_at: string | null
          long_lived_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          app_secret: string
          created_at?: string
          id?: string
          last_test_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          long_lived_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          app_secret?: string
          created_at?: string
          id?: string
          last_test_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          long_lived_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meta_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          metadata: Json | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pool_execution_log: {
        Row: {
          batch_index: number
          batch_number: number
          created_at: string
          cycle_number: number
          error: string | null
          executed_at: string | null
          id: string
          ig_account_id: string
          ig_media_id: string | null
          ig_permalink: string | null
          media_asset_id: string | null
          pool_id: string
          scheduled_at: string
          scheduled_post_id: string | null
          success: boolean | null
        }
        Insert: {
          batch_index: number
          batch_number: number
          created_at?: string
          cycle_number?: number
          error?: string | null
          executed_at?: string | null
          id?: string
          ig_account_id: string
          ig_media_id?: string | null
          ig_permalink?: string | null
          media_asset_id?: string | null
          pool_id: string
          scheduled_at: string
          scheduled_post_id?: string | null
          success?: boolean | null
        }
        Update: {
          batch_index?: number
          batch_number?: number
          created_at?: string
          cycle_number?: number
          error?: string | null
          executed_at?: string | null
          id?: string
          ig_account_id?: string
          ig_media_id?: string | null
          ig_permalink?: string | null
          media_asset_id?: string | null
          pool_id?: string
          scheduled_at?: string
          scheduled_post_id?: string | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "pool_execution_log_ig_account_id_fkey"
            columns: ["ig_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_execution_log_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_execution_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "media_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_execution_log_scheduled_post_id_fkey"
            columns: ["scheduled_post_id"]
            isOneToOne: false
            referencedRelation: "scheduled_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_videos: {
        Row: {
          created_at: string
          id: string
          last_posted_at: string | null
          media_asset_id: string
          pool_id: string
          position: number
          posted_in_current_cycle: boolean
          times_posted: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_posted_at?: string | null
          media_asset_id: string
          pool_id: string
          position?: number
          posted_in_current_cycle?: boolean
          times_posted?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_posted_at?: string | null
          media_asset_id?: string
          pool_id?: string
          position?: number
          posted_in_current_cycle?: boolean
          times_posted?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_videos_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_videos_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "media_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      post_media: {
        Row: {
          created_at: string
          id: string
          media_asset_id: string
          position: number
          post_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_asset_id: string
          position?: number
          post_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_asset_id?: string
          position?: number
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_media_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "scheduled_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          notification_email: boolean
          notify_on_failed: boolean
          notify_on_token_expiry: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          notification_email?: boolean
          notify_on_failed?: boolean
          notify_on_token_expiry?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          notification_email?: boolean
          notify_on_failed?: boolean
          notify_on_token_expiry?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_posts: {
        Row: {
          attempts_log: Json
          auto_retry_count: number
          caption: string
          cover_media_id: string | null
          cover_url: string | null
          created_at: string
          first_comment: string | null
          id: string
          ig_account_id: string
          ig_container_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          interval_minutes: number | null
          last_error: string | null
          location_id: string | null
          location_name: string | null
          next_retry_at: string | null
          post_type: string
          processing_lock_at: string | null
          published_at: string | null
          recurrence: string
          retry_count: number
          scheduled_at: string
          round_run_id: string | null
          source_pool_id: string | null
          status: string
          thumbnail_offset: number | null
          timezone: string
          updated_at: string
          user_id: string
          user_tags: Json
        }
        Insert: {
          attempts_log?: Json
          auto_retry_count?: number
          caption?: string
          cover_media_id?: string | null
          cover_url?: string | null
          created_at?: string
          first_comment?: string | null
          id?: string
          ig_account_id: string
          ig_container_id?: string | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          interval_minutes?: number | null
          last_error?: string | null
          location_id?: string | null
          location_name?: string | null
          next_retry_at?: string | null
          post_type: string
          processing_lock_at?: string | null
          published_at?: string | null
          recurrence?: string
          retry_count?: number
          scheduled_at: string
          round_run_id?: string | null
          source_pool_id?: string | null
          status?: string
          thumbnail_offset?: number | null
          timezone?: string
          updated_at?: string
          user_id: string
          user_tags?: Json
        }
        Update: {
          attempts_log?: Json
          auto_retry_count?: number
          caption?: string
          cover_media_id?: string | null
          cover_url?: string | null
          created_at?: string
          first_comment?: string | null
          id?: string
          ig_account_id?: string
          ig_container_id?: string | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          interval_minutes?: number | null
          last_error?: string | null
          location_id?: string | null
          location_name?: string | null
          next_retry_at?: string | null
          post_type?: string
          processing_lock_at?: string | null
          published_at?: string | null
          recurrence?: string
          retry_count?: number
          scheduled_at?: string
          round_run_id?: string | null
          source_pool_id?: string | null
          status?: string
          thumbnail_offset?: number | null
          timezone?: string
          updated_at?: string
          user_id?: string
          user_tags?: Json
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_cover_media_id_fkey"
            columns: ["cover_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_ig_account_id_fkey"
            columns: ["ig_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_source_pool_id_fkey"
            columns: ["source_pool_id"]
            isOneToOne: false
            referencedRelation: "media_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
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
      save_pool_video_order: {
        Args: { p_pool_id: string; p_video_ids: string[]; p_manual: boolean }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_principal: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin_principal" | "admin"
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
      app_role: ["admin_principal", "admin"],
    },
  },
} as const

