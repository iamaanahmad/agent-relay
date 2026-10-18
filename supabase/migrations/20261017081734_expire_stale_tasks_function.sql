/*
# Expire stale tasks helper

1. New Function
- `expire_stale_tasks(p_workspace_id uuid)`: fails any running task whose running
  window exceeded its timeout_minutes, and cancels queued tasks that were created
  more than their timeout_minutes ago and never claimed. Uses service_role from
  the edge function (bypasses RLS); the function itself filters by workspace.
2. Security
- SECURITY DEFINER, search_path pinned, EXECUTE revoked from anon/authenticated so
  only the edge function (service role) and owner can call it.
3. Notes
- Idempotent. Timeout for running tasks is measured from updated_at (claim time).
*/

CREATE OR REPLACE FUNCTION expire_stale_tasks(p_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tasks
  SET status = 'failed',
      error = 'task timed out',
      completed_at = now(),
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND status = 'running'
    AND updated_at + (timeout_minutes * interval '1 minute') < now();

  UPDATE tasks
  SET status = 'cancelled',
      error = 'task expired before being claimed',
      completed_at = now(),
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND status = 'queued'
    AND created_at + (timeout_minutes * interval '1 minute') < now();
$$;

REVOKE EXECUTE ON FUNCTION expire_stale_tasks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_stale_tasks(uuid) TO service_role;
