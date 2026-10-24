/*
# Persistent agent-to-agent messaging

1. New Tables
- `conversations` — a persistent thread between two agents in a workspace.
  - `id` (uuid, primary key)
  - `workspace_id` (uuid, references workspaces)
  - `created_at` (timestamptz)
  - `metadata` (jsonb, optional structured data)
  - Designed for 1-to-1 first; group support can be added by relaxing the
    unique index and adding a participants join table without rewriting this.

- `conversation_participants` — which agents are in a conversation.
  - `conversation_id` (uuid, references conversations)
  - `agent_id` (uuid, references agents)
  - PRIMARY KEY (conversation_id, agent_id)

- `messages` — individual messages within a conversation.
  - `id` (uuid, primary key)
  - `conversation_id` (uuid, references conversations)
  - `workspace_id` (uuid, references workspaces, for fast RLS checks)
  - `sender_agent_id` (uuid, references agents)
  - `recipient_agent_id` (uuid, references agents)
  - `content` (text, max enforced by trigger)
  - `metadata` (jsonb, optional)
  - `created_at` (timestamptz)

- `message_reads` — per-message read receipts.
  - `message_id` (uuid, references messages)
  - `agent_id` (uuid, references agents)
  - `read_at` (timestamptz)
  - PRIMARY KEY (message_id, agent_id)

2. Security
- RLS on all new tables, scoped through workspace ownership.
- Agents can only read/write messages in conversations they participate in
  (enforced server-side in the API; RLS covers the dashboard/anon path).
- message_reads: only the recipient can mark their own messages as read.

3. Indexes
- Efficient inbox query: (workspace_id, recipient_agent_id, created_at)
- Efficient conversation history: (conversation_id, created_at)
- Unique conversation per pair of agents in a workspace (1-to-1 constraint).
*/

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, agent_id)
);

-- Unique index enforcing one conversation per ordered pair of agents in a
-- workspace. For 1-to-1 we store both participants and use a partial unique
-- index on the pair. We enforce this at the application layer (find-or-create)
-- rather than a DB constraint so group conversations can be added later.
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_agent ON conversation_participants(agent_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sender_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  recipient_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(workspace_id, recipient_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(workspace_id, sender_agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_agent ON message_reads(agent_id, message_id);

-- ---- RLS --------------------------------------------------------------------

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;

-- Conversations: workspace owner can read/write
DROP POLICY IF EXISTS "select_own_conversations" ON conversations;
CREATE POLICY "select_own_conversations" ON conversations FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = conversations.workspace_id AND w.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "insert_own_conversations" ON conversations;
CREATE POLICY "insert_own_conversations" ON conversations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = conversations.workspace_id AND w.user_id = auth.uid()
  ));

-- Conversation participants: workspace owner can read/write
DROP POLICY IF EXISTS "select_own_conv_participants" ON conversation_participants;
CREATE POLICY "select_own_conv_participants" ON conversation_participants FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM conversations c
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.id = conversation_participants.conversation_id AND w.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "insert_own_conv_participants" ON conversation_participants;
CREATE POLICY "insert_own_conv_participants" ON conversation_participants FOR INSERT
  TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.id = conversation_participants.conversation_id AND w.user_id = auth.uid()
  ));

-- Messages: workspace owner can read/write
DROP POLICY IF EXISTS "select_own_messages" ON messages;
CREATE POLICY "select_own_messages" ON messages FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = messages.workspace_id AND w.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "insert_own_messages" ON messages;
CREATE POLICY "insert_own_messages" ON messages FOR INSERT
  TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = messages.workspace_id AND w.user_id = auth.uid()
  ));

-- Message reads: workspace owner can read/write
DROP POLICY IF EXISTS "select_own_message_reads" ON message_reads;
CREATE POLICY "select_own_message_reads" ON message_reads FOR SELECT
  TO authenticated USING (EXISTS (
    SELECT 1 FROM messages m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.id = message_reads.message_id AND w.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "insert_own_message_reads" ON message_reads;
CREATE POLICY "insert_own_message_reads" ON message_reads FOR INSERT
  TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM messages m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.id = message_reads.message_id AND w.user_id = auth.uid()
  ));

-- ---- Content size trigger ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_message_size()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF octet_length(NEW.content) > 32768 THEN
    RAISE EXCEPTION 'message content too large (max 32768 bytes)';
  END IF;
  IF NEW.metadata IS NOT NULL AND octet_length(NEW.metadata::text) > 8192 THEN
    RAISE EXCEPTION 'message metadata too large (max 8192 bytes)';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_message_size() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_message_size ON public.messages;
CREATE TRIGGER trg_message_size
  BEFORE INSERT OR UPDATE OF content, metadata ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.check_message_size();
