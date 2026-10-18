# Private Beta — Release Checklist

## First successful delegation (exact steps)

Do this with two MCP clients (e.g. Claude Desktop and another MCP-capable assistant, or two profiles of the same client).

1. **Sign up** at `/signup` with email and password (email confirmation is off; you land in the dashboard).
2. **Create a workspace** — the dashboard shows a first-run screen; name it and submit.
3. **Add the sender agent** — Agents page → Add agent → name it (e.g. `coordinator`).
4. **Generate its token** — open the agent's Connect page → Generate token → copy the `ar_…` value now (shown once).
5. **Connect client A** — paste into the sender's MCP config:
   ```json
   { "mcpServers": { "agent-relay": { "url": "<SUPABASE_URL>/functions/v1/mcp", "headers": { "Authorization": "Bearer ar_…" } } } }
   ```
6. **Verify the connection** — on the same Connect page, paste the token into "Test a connection token" and press Test. It should say connection succeeded.
7. **Add the recipient agent** — repeat steps 3–5 for a second agent (`worker`) and connect client B with its own token.
8. **Delegate** — in client A: `send_task` with `recipient_agent_name: "worker"`, a `title` and `instructions`. The response includes a `task_id` and status `queued`.
9. **Work the task** — in client B: `claim_task` (optionally with the `task_id`), do the work, then `update_task` with `status: "completed"` and a `result` object.
10. **Confirm end-to-end** — in client A: `get_result` with the `task_id`; the result object comes back. In the dashboard: the task appears on Inbox (Agent tasks tab) with status Completed, and every lifecycle step shows on the Activity page.

**Approval path (optional, verify once before inviting users):** in step 8 add `requires_approval: true`. The task lands on the Approvals page as Awaiting approval; press Approve, then client B can claim it.

## Automated verification (already passing)

- `node tests/e2e.mjs` — 46/46 passing against the live deployment: auth, workspace isolation, full delegation cycle, approval workflow, state machine, audit trail, cancellation, concurrent claims, revocation, rate limiting, RLS, and the audit regression tests.
- Production build passes.

## Pre-invite checklist (manual, in a real browser)

- [ ] Sign-up → first-run workspace screen → dashboard loads.
- [ ] Add agent → generate token → token shown once and listed as Active on the agent page.
- [ ] "Test a connection token" returns success for a live token and a clear rejection for a revoked one (revoke first, then test).
- [ ] Send task page → send a direct task to an agent → appears under Inbox → Sent by you.
- [ ] Agent-delegated task → approve on Approvals page → status becomes Queued.
- [ ] Reject path: rejecting an approval-flagged task marks it Cancelled.
- [ ] Cancel a queued task from the Inbox detail dialog.
- [ ] Activity page shows created/claimed/completed events with timestamps.
- [ ] Sign out → sign in → active workspace persists.
- [ ] With two tokens: revoke one, confirm its MCP client gets 401 on the next call.

## Configuration verified

- `.env` holds only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both public-by-design values safe for browser exposure).
- No service-role key appears anywhere in frontend code; it exists only inside the MCP edge function runtime.
- Agent tokens are stored solely as SHA-256 hashes; plaintext shown once at generation.
- `supabase/config.toml` declares the `mcp` function with `verify_jwt = false` (intentional: agents authenticate with relay tokens, not Supabase JWTs).
- Security advisor: no WARN/ERROR findings.

## Known limitations to communicate to beta users

- Recipients poll via `claim_task`; no push notifications.
- Timeout expiry is lazy (evaluated on the next MCP call), so a timed-out task's status may lag until then.
- Rate limit fixed at 100 requests/min/token.
- Email/password auth only.
