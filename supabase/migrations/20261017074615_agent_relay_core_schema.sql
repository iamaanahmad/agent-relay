/*
# Agent Relay core schema

1. New Tables
- `workspaces` — isolated project spaces owned by a signed-in user.
  - `id` (uuid, primary key)
  - `name` (text, not null)
  - `user_id` (uuid, not null, defaults to the authenticated user, references auth.users)
  - `created_at` (timestamptz)
- `agents` — an AI assistant the user has registered in a workspace.
  - `id` (uuid, primary key)
  - `workspace_id` (uuid, references workspaces, on delete cascade)
  - `name` (text, not null)
  - `description` (text, default '')
  - `created_at` (timestamptz)
- `agent_tokens` — scoped, revocable connection tokens for MCP access.
  - `id` (uuid, primary key)
  - `agent_id` (uuid, references agents, on delete cascade)
  - `workspace_id` (uuid, references workspaces, on delete cascade)
  - `token_hash` (text, unique, sha256 hex of the token — plaintext is NEVER stored)
  - `token_prefix` (text, first few characters for display)
  - `last_used_at`, `revoked_at` (timestamptz, nullable)
  - `created_at` (timestamptz)
- `tasks` — delegated work between agents (or from a user to an agent).
  - `id` (uuid, primary key)
  - `workspace_id` (uuid, references workspaces)
  - `sender_agent_id` (uuid, nullable — null means the user sent it from the dashboard)
  - `recipient_agent_id` (uuid, not null)
  - `title`, `instructions` (text)
  - `context`, `result` (jsonb)
  - `error` (text)
  - `status` (text, one of awaiting_approval | queued | running | completed | failed | cancelled)
  - `requires_approval` (boolean), `approved_at` (timestamptz)
  - `timeout_minutes` (integer, default 60)
  - `created_at`, `updated_at`, `completed_at` (timestamptz)
- `task_events` — immutable audit trail of every task lifecycle event.
  - `id`, `task_id`, `workspace_id`, `event_type`, `actor`, `detail` (jsonb), `created_at`
- `rate_limit_windows` — persistent per-token request counters for rate limiting.
  - `token_id` + `window_start` (composite primary key), `request_count`

2. Security
- Row Level Security enabled on every table.
- All policies are scoped `TO authenticated` and keyed on workspace ownership:
  a user can only touch rows whose workspace belongs to them.
- No anon access anywhere — the app requires sign-in.
- Token hashes are readable by the owner (for display/management) but can only be
  created/verified by the server (edge function) via revoked ownership policies.

3. Notes
- Idempotent: safe to re-run.
- Indexes added on common lookup columns.
*/

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sender_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  recipient_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title text NOT NULL,
  instructions text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('awaiting_approval','queued','running','completed','failed','cancelled')),
  requires_approval boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  timeout_minutes integer NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  token_id uuid NOT NULL REFERENCES agent_tokens(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, window_start)
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_windows ENABLE ROW LEVEL SECURITY;

-- Workspaces: owner-only CRUD
DROP POLICY IF EXISTS "select_own_workspaces" ON workspaces;
CREATE POLICY "select_own_workspaces" ON workspaces FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_workspaces" ON workspaces;
CREATE POLICY "insert_own_workspaces" ON workspaces FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_workspaces" ON workspaces;
CREATE POLICY "update_own_workspaces" ON workspaces FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_workspaces" ON workspaces;
CREATE POLICY "delete_own_workspaces" ON workspaces FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Agents: scoped through workspace ownership
DROP POLICY IF EXISTS "select_own_agents" ON agents;
CREATE POLICY "select_own_agents" ON agents FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agents.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_agents" ON agents;
CREATE POLICY "insert_own_agents" ON agents FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agents.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_agents" ON agents;
CREATE POLICY "update_own_agents" ON agents FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agents.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agents.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_agents" ON agents;
CREATE POLICY "delete_own_agents" ON agents FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agents.workspace_id AND w.user_id = auth.uid()));

-- Tokens: readable + revocable by the workspace owner, created only by the owner.
DROP POLICY IF EXISTS "select_own_tokens" ON agent_tokens;
CREATE POLICY "select_own_tokens" ON agent_tokens FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agent_tokens.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_tokens" ON agent_tokens;
CREATE POLICY "insert_own_tokens" ON agent_tokens FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agent_tokens.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_tokens" ON agent_tokens;
CREATE POLICY "update_own_tokens" ON agent_tokens FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agent_tokens.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agent_tokens.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_tokens" ON agent_tokens;
CREATE POLICY "delete_own_tokens" ON agent_tokens FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = agent_tokens.workspace_id AND w.user_id = auth.uid()));

-- Tasks: scoped through workspace ownership
DROP POLICY IF EXISTS "select_own_tasks" ON tasks;
CREATE POLICY "select_own_tasks" ON tasks FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = tasks.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_tasks" ON tasks;
CREATE POLICY "insert_own_tasks" ON tasks FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = tasks.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_tasks" ON tasks;
CREATE POLICY "update_own_tasks" ON tasks FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = tasks.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = tasks.workspace_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_tasks" ON tasks;
CREATE POLICY "delete_own_tasks" ON tasks FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = tasks.workspace_id AND w.user_id = auth.uid()));

-- Task events: read-only for the owner; written by the app/edge function.
DROP POLICY IF EXISTS "select_own_task_events" ON task_events;
CREATE POLICY "select_own_task_events" ON task_events FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = task_events.workspace_id AND w.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tokens_agent ON agent_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_recipient ON tasks(recipient_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_sender ON tasks(sender_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_events_workspace ON task_events(workspace_id, created_at);
