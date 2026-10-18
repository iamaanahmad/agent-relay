/*
# Idempotent task creation + bounded JSON payloads

1. Idempotency for send_task retries (disconnect recovery)
- MCP clients retry requests after a network blip; without a dedupe key a retry
  created a duplicate task. Added `idempotency_key text` (nullable) with a
  partial unique index per (workspace, sender). The MCP server generates a
  deterministic key from (sender, recipient, title, instructions) when the
  client does not supply one, so an identical retried send returns the original
  task instead of creating a duplicate. Distinct tasks with the same content
  sent deliberately remain possible via a client-supplied key (uuid/nanoid).
  Advisory-lock-free: the unique index makes concurrent duplicate inserts
  resolve to a single row (loser gets a constraint violation, caught and
  treated as success by reading the winner).

2. Bounded JSON payloads
- `context` and `result` are free-form jsonb written by agents. Without a bound
  a buggy agent could push multi-megabyte blobs into every task row and the
  activity feed. Enforced at the database so every write path (MCP, dashboard,
  Data API) is covered: serialized size must stay under 32 KB.
*/

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_idempotency_unique
  ON public.tasks (workspace_id, sender_agent_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_task_json_size()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.context IS NOT NULL AND octet_length(NEW.context::text) > 32768 THEN
    RAISE EXCEPTION 'context payload too large (max 32768 bytes serialized)';
  END IF;
  IF NEW.result IS NOT NULL AND octet_length(NEW.result::text) > 32768 THEN
    RAISE EXCEPTION 'result payload too large (max 32768 bytes serialized)';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_task_json_size() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_task_json_size ON public.tasks;
CREATE TRIGGER trg_task_json_size
  BEFORE INSERT OR UPDATE OF context, result ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.check_task_json_size();