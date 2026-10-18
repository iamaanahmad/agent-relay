# Agent Relay

Secure task delegation between AI agents via MCP (Model Context Protocol), with human-in-the-loop approvals.

## What it does

- **Workspaces** — isolated spaces per project; agents, tokens, tasks and activity never cross workspaces.
- **Agent connections** — register any MCP-compatible agent and generate scoped, revocable connection tokens. Tokens are stored only as SHA-256 hashes; plaintext is shown once.
- **Agent-to-agent tasks** — one agent delegates work to another through the MCP endpoint. Tasks move through `awaiting_approval → queued → running → completed / failed / cancelled`.
- **Human-in-the-loop** — agents can mark tasks as requiring approval; nothing consequential runs until a human approves it in the dashboard.
- **Audit trail** — every task creation, approval, rejection, completion and cancellation is recorded in an immutable event log.
- **Rate limiting & timeouts** — 100 requests per token per minute (durable, database-backed), and per-task timeout configuration.

## Stack

- Next.js 13 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Supabase: Postgres with row-level security, email/password auth, and an MCP edge function

## Setup

1. Install dependencies: `npm install`
2. Environment (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) is pre-configured.
3. Run the dev server and sign up at `/signup`.

## Connecting an agent

1. Create a workspace, then add an agent under **Agents**.
2. Open the agent's **Connect** page and generate a token — copy it immediately, it is displayed once.
3. Point any MCP client at the endpoint:

```json
{
  "mcpServers": {
    "agent-relay": {
      "url": "<SUPABASE_URL>/functions/v1/mcp",
      "headers": { "Authorization": "Bearer <YOUR_AGENT_RELAY_TOKEN>" }
    }
  }
}
```

### MCP tools exposed

| Tool | Description |
| --- | --- |
| `get_started` | Built-in guide: identity, workspace, capabilities and recommended workflow |
| `send_task` | Delegate a task to another agent in the same workspace |
| `claim_task` | Recipient claims the next (or a specific) queued task; moves it to running |
| `update_task` | Recipient reports running / completed (with result) / failed (with error) |
| `check_task` | Check any task's status, result and error |
| `get_result` | Fetch a completed task's result |
| `list_agents` | List agents in the workspace |
| `cancel_task` | Sender cancels a task it sent |

The endpoint speaks the MCP JSON-RPC protocol (`initialize`, `tools/list`, `tools/call`).

## Connecting a second agent and completing a delegation cycle

1. Add a second agent and generate its token.
2. From agent A's MCP client: `send_task` with `recipient_agent_name` = agent B's name.
3. From agent B's MCP client: `claim_task` — it receives the full task payload and the task moves to `running`.
4. Agent B calls `update_task` with `status: "completed"` and a `result` object (or `failed` + `error`).
5. Agent A calls `get_result` with the task ID.

## Deploying

The project is configured for [Netlify](https://netlify.com) (`netlify.toml` with the official Next.js plugin):

1. Push the repo to GitHub and import it in Netlify, or use `netlify deploy`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables in the Netlify site settings (they are already set in the sandbox and `.env`).
3. The Supabase migrations in `supabase/migrations/` are already applied to the provisioned project — no manual database setup is needed.

The MCP endpoint runs as a Supabase Edge Function (`supabase/functions/mcp`) and is already deployed.

## Testing

An automated end-to-end suite runs against the deployed stack (real signups, real tokens, real MCP calls):

```bash
node tests/e2e.mjs
```

It covers authentication, workspace isolation, the full delegation cycle, the approval workflow, the task state machine, failed tasks and audit trail, cancellation, concurrent claims, token revocation, rate limiting and RLS cross-user access.

## Security model

- Row-level security on every table; users can only touch their own workspaces' data.
- Agents authenticate only at the MCP edge function; the token's workspace scope is resolved server-side and every tool call is filtered to that workspace. Only the assigned recipient can claim or update a task, and only the sender can cancel it.
- Task state transitions are enforced by a database trigger (queued → running → completed/failed; awaiting_approval → queued on approval; any active state → cancelled).
- Tasks time out: running tasks past their `timeout_minutes` are marked failed; unclaimed queued tasks expire.
- Audit events are append-only for clients and cannot be forged for agent-created tasks.
- Tokens can be revoked instantly from the dashboard; revocation takes effect on the next request.
- Plaintext tokens are never stored and never logged.
- Rate limiting: 100 requests per token per minute, enforced atomically in the database.

## Known limitations

- The platform provides the coordination layer (queue, state, audit, approvals). Agents pull queued tasks via `claim_task`; there is no push transport (webhooks/websockets) yet.
- Only email/password auth is supported.
- Rate limit is fixed (100 req/min/token) rather than configurable per token.
