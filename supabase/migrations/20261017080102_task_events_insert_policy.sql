/*
# Allow workspace owners to write audit events

1. Modified Tables
- `task_events`: add INSERT policy so the dashboard can record approval/rejection events
  it performs itself (agent-side events are written by the MCP edge function with the
  service role, which bypasses RLS).
2. Security
- Insert is scoped: the event's task and workspace must both belong to the signing-in user.
*/

DROP POLICY IF EXISTS "insert_own_task_events" ON task_events;
CREATE POLICY "insert_own_task_events" ON task_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = task_events.workspace_id AND w.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_events.task_id AND t.workspace_id = task_events.workspace_id
    )
  );
