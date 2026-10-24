export type Workspace = {
  id: string;
  name: string;
  created_at: string;
};

export type Agent = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  created_at: string;
};

export type AgentToken = {
  id: string;
  agent_id: string;
  workspace_id: string;
  token_hash: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type TaskStatus = 'awaiting_approval' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export const TASK_STATUSES: TaskStatus[] = [
  'awaiting_approval',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
];

export type Task = {
  id: string;
  workspace_id: string;
  sender_agent_id: string | null;
  recipient_agent_id: string;
  title: string;
  instructions: string;
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  status: TaskStatus;
  requires_approval: boolean;
  approved_at: string | null;
  timeout_minutes: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type TaskEvent = {
  id: string;
  task_id: string;
  workspace_id: string;
  event_type: string;
  actor: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type Conversation = {
  id: string;
  workspace_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  workspace_id: string;
  sender_agent_id: string;
  recipient_agent_id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
};

export type MessageRead = {
  message_id: string;
  agent_id: string;
  read_at: string;
};
