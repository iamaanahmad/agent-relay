/*
# Group Messaging & Channel Support

1. Schema Changes
- `conversations`:
  - `type` (text, 'dm' | 'group', default 'dm')
  - `title` (text, nullable, e.g. group channel name)
  - `created_by_user_id` (uuid, references auth.users)
- `messages`:
  - `recipient_agent_id` made NULLABLE (for group broadcasts to all participants)
  - `sender_agent_id` made NULLABLE (for human operator / user messages from dashboard)
  - `sender_user_id` (uuid, references auth.users, for human operator messages)

2. Indexes
- `idx_conversations_type` ON conversations(workspace_id, type)
- `idx_messages_conv_created` ON messages(conversation_id, created_at ASC)
*/

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'dm' CHECK (type IN ('dm', 'group'));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id);

ALTER TABLE messages ALTER COLUMN recipient_agent_id DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN sender_agent_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC);
