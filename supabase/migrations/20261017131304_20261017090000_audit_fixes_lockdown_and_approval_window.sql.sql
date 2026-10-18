/*
# Audit fixes: privilege lockdown + approval-aware timeout window

1. Privilege lockdown (security advisor findings)
- `enforce_task_transition` is SECURITY DEFINER and was callable via the Data API
  by anon/authenticated. It is a trigger function; direct RPC serves no purpose.
  Revoke EXECUTE from PUBLIC, anon and authenticated.

2. Approval-aware queued-task timeout (correctness fix)
- The queued-task expiry in `expire_stale_tasks` measured the queue window from
  `created_at`. For an approval-flagged task the clock ran while it sat in
  `awaiting_approval`, so an approval granted after timeout_minutes had passed
  created the task as queued and the very next claim/check immediately cancelled
  it as "expired before being claimed". Approval latency was punished.
- Fix: measure the queued window from `approved_at` when the task came through
  approval (approved_at is set exactly when it moved to queued), otherwise from
  created_at.
*/

-- 1. Lock down the trigger function
REVOKE EXECUTE ON FUNCTION public.enforce_task_transition() FROM PUBLIC, anon, authenticated;

-- 2. Approval-aware queued expiry
CREATE OR REPLACE FUNCTION public.expire_stale_tasks(p_workspace_id uuid)
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
    AND COALESCE(approved_at, created_at) + (timeout_minutes * interval '1 minute') < now();
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_tasks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_tasks(uuid) TO service_role;