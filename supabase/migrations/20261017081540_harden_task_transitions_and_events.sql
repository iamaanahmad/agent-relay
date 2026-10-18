/*
# Harden task state transitions and audit event inserts

1. New trigger
- `tasks_enforce_transition` on `tasks` BEFORE UPDATE:
  blocks illegal status changes (e.g. completed -> running, cancelled -> queued)
  and stamps updated_at. Valid transitions:
  * any -> cancelled  (owner or sender can cancel from queued/running/awaiting_approval)
  * awaiting_approval -> queued  (owner approval)
  * queued -> running  (agent claim)
  * running -> completed / failed  (agent result submission)
  * same -> same  (no-op updates like touching updated_at)
  Note: owners can also mark queued/awaiting_approval tasks failed or cancelled
  directly; the trigger allows awaiting_approval -> cancelled and
  queued -> cancelled explicitly. Owner-driven completion is NOT allowed from
  the frontend - only agents report results.

2. Modified policies
- `task_events`: the old INSERT policy allowed a user to forge events for ANY task
  in their workspace (including agent-created ones) with any actor string. That was
  an audit-integrity hole. Replaced with:
  * users may only insert events for tasks THEY created (sender_agent_id IS NULL
    means the workspace owner sent it from the dashboard), with actor = 'user'
  * agent-side events are written by the edge function with the service role,
    which bypasses RLS
- Also: users can no longer update or delete task_events (audit rows are immutable
  to clients). UPDATE/DELETE grants are revoked and no policies exist for them.

3. Notes
- Idempotent: safe to re-run.
*/

CREATE OR REPLACE FUNCTION enforce_task_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status IN ('awaiting_approval','queued','running') THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'awaiting_approval' AND NEW.status = 'queued' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'queued' AND NEW.status = 'running' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'running' AND NEW.status IN ('completed','failed') THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid task status transition from % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_task_transition ON tasks;
CREATE TRIGGER trg_enforce_task_transition
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION enforce_task_transition();

-- Task events: insert allowed only for owner-sent tasks, actor forced to 'user'.
DROP POLICY IF EXISTS "insert_own_task_events" ON task_events;
CREATE POLICY "insert_own_task_events" ON task_events FOR INSERT
  TO authenticated
  WITH CHECK (
    actor = 'user'
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_events.task_id
        AND t.workspace_id = task_events.workspace_id
        AND t.sender_agent_id IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = task_events.workspace_id AND w.user_id = auth.uid()
    )
  );

-- Audit rows are immutable to clients: no update/delete policies, and revoke grants.
DROP POLICY IF EXISTS "update_task_events" ON task_events;
DROP POLICY IF EXISTS "delete_task_events" ON task_events;
REVOKE UPDATE, DELETE ON public.task_events FROM anon, authenticated;
