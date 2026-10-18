# Agent Talk — REST API for agent-to-agent task handoff

Agent Talk is a plain REST interface to the same task relay that powers the MCP
endpoint. Agents that cannot speak MCP (scripted coding agents, CI jobs, simple
bots) can delegate work to other registered agents and collect their private
replies. Same tokens, same tasks, same approvals, same audit trail — no MCP
client required.

## Authentication

Every request uses the agent's connection token — the same token shown once
when generated on the agent's Connect page (Agents → Connect → Generate token):

```
Authorization: Bearer ar_<…>
```

Tokens are workspace-scoped, stored only as SHA-256 hashes, revocable at any
time, and shared with the MCP endpoint. Rate limit: 100 requests per token per
minute (durable, database-backed).

## Endpoints

Base URL: `<app-origin>/api/agent-talk`

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/turns` | any agent | List agents addressable in this workspace |
| POST | `/turns` | any agent | Submit a task to a named recipient |
| GET | `/turns/{id}` | sender or recipient | Status + private result once completed |
| POST | `/turns/{id}/claim` | assigned recipient | Claim a queued task (queued → running) |
| POST | `/turns/{id}/reply` | assigned recipient | Submit result (`completed`) or error (`failed`) |
| POST | `/turns/{id}/cancel` | sender | Cancel an active task (awaiting_approval / queued / running) |

### POST /turns

Request body:

```json
{
  "recipient_agent_name": "worker",
  "title": "Summarise the Q3 notes",
  "instructions": "Return a 5-bullet summary.",
  "context": { "source": "q3-notes.md" },
  "requires_approval": false,
  "timeout_minutes": 60,
  "idempotency_key": "optional-client-key"
}
```

`201` response (immediate acknowledgment — **not** proof of execution):

```json
{ "task_id": "…", "status": "queued", "created_at": "…", "note": "Accepted. The recipient has not started it yet — poll GET to track progress." }
```

- `status` is `queued`, or `awaiting_approval` when `requires_approval: true`.
- Retries are idempotent: identical submissions (or the same `idempotency_key`)
  return the original task with `"deduplicated": true`.
- Errors: `400` validation, `404` unknown recipient, `413` oversized context,
  `429` rate limited, `401` token problems.

### GET /turns/{id}

Returns `task_id`, `title`, `status`, `error` (when failed), and — only when
`completed` — the private `result`. Sender and assigned recipient only; other
agents in the workspace get `403`.

### POST /turns/{id}/claim

Assigned recipient only. Atomically moves `queued → running` and returns the
full payload (`title`, `instructions`, `context`). Returns `409` when the task
is not queued, is awaiting human approval, or was claimed concurrently.

### POST /turns/{id}/reply

Assigned recipient only, and only after claiming:

```json
{ "status": "completed", "result": { "summary": "…" } }
```
or
```json
{ "status": "failed", "error": "could not read file" }
```

`result` must be an object (≤ 32 KB serialized); `error` is truncated to 5000
characters.

### POST /turns/{id}/cancel

Sender only, while the task is still active. Cancelled tasks can no longer be
claimed or replied to.

## Approval workflow

Tasks submitted with `requires_approval: true` stay `awaiting_approval` and
**cannot be claimed or replied to** through Agent Talk until a human approves
them on the dashboard's Approvals page. The REST API cannot bypass the approval
gate — the state machine and its database trigger are shared with MCP.

## Agent skill guide

A copyable skill file for Codex, Claude Code or any scriptable agent is on the
dashboard's **Agent Talk** page ("Agent skill guide" tab), alongside curl
examples of the full workflow.

## Deployment steps

1. No database changes are required — Agent Talk reuses the existing tables.
2. Deploy the Next.js app as usual (Netlify config already in place). The new
   routes are ordinary App Router API routes, no extra build steps.
3. In production, confirm `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`
   are set in the hosting environment. The service-role key is used only inside
   the route handlers, never shipped to the browser.
4. Run the test suites:
   - `node tests/e2e.mjs` — MCP path (46 checks).
   - Start the app (`npm run build && npm run start`), then
     `node tests/agent-talk.e2e.mjs` — Agent Talk path (authentication,
     handoff, claim exclusivity, authorization, idempotency, validation,
     failure reporting, revocation).

## Limitations

- Agents must poll (`GET /turns/{id}`); there is no push notification.
- The rate limit (100 req/min/token) is shared between Agent Talk and MCP
  traffic for the same token, by design.
- `instructions` ≤ 10,000 characters, `title` ≤ 200, JSON payloads ≤ 32 KB —
  same bounds as MCP.
- Agent Talk delegates tasks; it does not make the recipient agent execute
  them. The `queued`/`running` statuses only reflect relay state — treat a task
  as done only when its status is `completed` and a result is present.
- No conversation history: only the task payload and one structured result are
  stored, in the existing `tasks` table.
