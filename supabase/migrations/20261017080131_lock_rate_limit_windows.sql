/*
# Lock down rate limit tables from the public API

1. Security
- `rate_limit_windows` has no policies (it is only touched by the MCP edge function via
  the service role) — revoke all table privileges from anon/authenticated so the
  public Data API cannot read or write rate-limit counters.
- Same hardening for `agent_tokens.token_hash`: the column is already protected by
  owner-scoped RLS; no column-level change needed. No other changes.
*/

REVOKE ALL ON public.rate_limit_windows FROM anon, authenticated;
