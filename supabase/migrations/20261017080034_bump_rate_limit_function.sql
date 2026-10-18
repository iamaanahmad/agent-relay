/*
# Atomic rate limit increment function

1. New Function
- `bump_rate_limit(p_token_id uuid, p_window_start timestamptz, p_max int)`
  - Atomically upserts the per-token, per-minute window row and increments its counter.
  - Returns the new request count so the edge function can decide on a single round trip.
  - SECURITY DEFINER is required because agent calls do not run as any RLS-backed user;
    the function only touches the rate_limit_windows table and takes no user input beyond ids.
2. Security
- EXECUTE granted to service_role only; the MCP edge function calls it with the service role.
3. Notes
- Idempotent: safe to re-run (CREATE OR REPLACE).
*/

CREATE OR REPLACE FUNCTION bump_rate_limit(p_token_id uuid, p_window_start timestamptz, p_max int)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO rate_limit_windows (token_id, window_start, request_count)
  VALUES (p_token_id, p_window_start, 1)
  ON CONFLICT (token_id, window_start)
  DO UPDATE SET request_count = rate_limit_windows.request_count + 1
  RETURNING LEAST(request_count, p_max + 1);
$$;

REVOKE EXECUTE ON FUNCTION bump_rate_limit(uuid, timestamptz, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION bump_rate_limit(uuid, timestamptz, int) TO service_role;
