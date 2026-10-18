export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          user_id?: string;
          created_at?: string;
        };
        Update: {
          name?: string;
        };
      };
      agents: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          description?: string;
        };
      };
      agent_tokens: {
        Row: {
          id: string;
          agent_id: string;
          workspace_id: string;
          token_hash: string;
          token_prefix: string;
          last_used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          workspace_id: string;
          token_hash: string;
          token_prefix: string;
        };
        Update: {
          revoked_at?: string | null;
          last_used_at?: string | null;
        };
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          sender_agent_id: string | null;
          recipient_agent_id: string;
          title: string;
          instructions: string;
          context: Json;
          result: Json | null;
          error: string | null;
          status: string;
          requires_approval: boolean;
          approved_at: string | null;
          timeout_minutes: number;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          sender_agent_id?: string | null;
          recipient_agent_id: string;
          title: string;
          instructions: string;
          context?: Json;
          status?: string;
          requires_approval?: boolean;
          timeout_minutes?: number;
        };
        Update: {
          status?: string;
          error?: string | null;
          result?: Json | null;
          approved_at?: string | null;
          updated_at?: string;
          completed_at?: string | null;
        };
      };
      task_events: {
        Row: {
          id: string;
          task_id: string;
          workspace_id: string;
          event_type: string;
          actor: string;
          detail: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          workspace_id: string;
          event_type: string;
          actor: string;
          detail?: Json;
        };
        Update: Record<string, never>;
      };
      rate_limit_windows: {
        Row: {
          token_id: string;
          window_start: string;
          request_count: number;
        };
        Insert: {
          token_id: string;
          window_start: string;
          request_count?: number;
        };
        Update: {
          request_count?: number;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
