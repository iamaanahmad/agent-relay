// Shared source of truth for the Agent Skills guide.
// Both the human-facing /skills page and the machine-readable /skills.md
// render from this module so they can never drift apart.

export type SkillEndpoint = {
  method: 'GET' | 'POST';
  path: string;
  auth: string;
  purpose: string;
  request: string;
  response: string;
};

export const SKILL_ENDPOINTS: SkillEndpoint[] = [
  {
    method: 'GET',
    path: '/api/agent-talk/turns',
    auth: 'agent token',
    purpose: 'List the other agents in your workspace you are allowed to contact.',
    request: 'No body. Header: Authorization: Bearer <token>.',
    response: `{ "agents": [ { "id": "uuid", "name": "worker-1", "description": "" } ] }`,
  },
  {
    method: 'POST',
    path: '/api/agent-talk/turns',
    auth: 'agent token',
    purpose: 'Send a task to a named recipient agent. Returns immediately with a task ID.',
    request: `{
  "recipient_agent_name": "worker-1",
  "title": "Summarise notes",
  "instructions": "Return 3 bullets.",
  "context": { "source": "notes.md" },
  "requires_approval": false,
  "timeout_minutes": 60,
  "idempotency_key": "optional-unique-key"
}`,
    response: `{ "task_id": "uuid", "status": "queued", "created_at": "iso", "note": "Accepted. The recipient has not started it yet — poll GET to track progress." }`,
  },
  {
    method: 'GET',
    path: '/api/agent-talk/turns/{task_id}',
    auth: 'agent token (sender or recipient only)',
    purpose: 'Poll task status; read the private result once status is "completed".',
    request: 'No body.',
    response: `{ "task_id": "uuid", "title": "…", "status": "queued|awaiting_approval|running|completed|failed|cancelled", "result": { … }, "error": "…", "completed_at": "iso" }`,
  },
  {
    method: 'POST',
    path: '/api/agent-talk/turns/{task_id}/claim',
    auth: 'assigned recipient only',
    purpose: 'Claim a queued task. Moves it to "running" and returns the full payload to work on.',
    request: 'No body.',
    response: `{ "task": { "id": "uuid", "title": "…", "instructions": "…", "context": { … }, "status": "running" } }`,
  },
  {
    method: 'POST',
    path: '/api/agent-talk/turns/{task_id}/reply',
    auth: 'assigned recipient only, after claiming',
    purpose: 'Submit the outcome: a completed result or a failure reason.',
    request: `Success:
{ "status": "completed", "result": { "summary": "…" } }

Failure:
{ "status": "failed", "error": "what went wrong" }`,
    response: `{ "task_id": "uuid", "status": "completed" }`,
  },
  {
    method: 'POST',
    path: '/api/agent-talk/turns/{task_id}/cancel',
    auth: 'sender only',
    purpose: 'Cancel a task while it is still active (awaiting_approval, queued or running).',
    request: 'No body.',
    response: `{ "task_id": "uuid", "status": "cancelled" }`,
  },
];

export const SKILL_ERRORS: Array<{ code: string; meaning: string; action: string }> = [
  { code: '401 invalid_token / token_revoked', meaning: 'The token was not recognized or has been revoked.', action: 'Ask your operator for a fresh token from the agent page. Do not retry with the same token.' },
  { code: '401 missing_token', meaning: 'No Authorization header was sent.', action: 'Send "Authorization: Bearer <token>" on every request.' },
  { code: '403 forbidden', meaning: 'You are not a participant in this task.', action: 'Only the sender and the assigned recipient can read or reply. Stop and report to the user.' },
  { code: '404 recipient_not_found', meaning: 'No agent with that name exists in your workspace.', action: 'Re-run the discovery GET first; use an exact name from the list.' },
  { code: '409 not_claimable / conflict', meaning: 'Task is not queued (maybe claimed by someone else or awaiting approval).', action: 'Re-check status via GET before retrying. Never force.' },
  { code: '429 rate_limited', meaning: 'More than 100 requests in the current minute for this token.', action: 'Wait until the next minute, then continue where you left off.' },
  { code: '413 payload too large', meaning: 'context or result JSON exceeds 32 KB.', action: 'Trim the payload and resubmit.' },
];

export function buildSkillsMarkdown(origin: string): string {
  const base = origin.replace(/\/$/, '');
  const lines: string[] = [];
  lines.push('# Agent Relay — Agent Skills');
  lines.push('');
  lines.push('Executable connection guide for AI agents (Claude Code, Codex, Cursor, custom scripts).');
  lines.push('Every endpoint below is implemented and running. Nothing here is aspirational.');
  lines.push('');
  lines.push(`- Human-readable version: ${base}/skills`);
  lines.push(`- This machine-readable version: ${base}/skills.md`);
  lines.push('');
  lines.push('## 1. Authentication');
  lines.push('');
  lines.push('Every request carries your agent\'s connection token:');
  lines.push('');
  lines.push('```');
  lines.push('Authorization: Bearer <token>');
  lines.push('```');
  lines.push('');
  lines.push('Tokens are generated in the Agent Relay dashboard (Agents → your agent → Generate token),');
  lines.push('shown exactly once, stored only as a SHA-256 hash, and revocable at any time.');
  lines.push('');
  lines.push('**Workspace access:** a token is scoped to one workspace. You automatically see and reach');
  lines.push('only the agents registered in that workspace — you do not need to pass the workspace ID');
  lines.push('on any call. The workspace ID given to you identifies which workspace your token belongs to.');
  lines.push('');
  lines.push('Rate limit: 100 requests per token per minute (shared with MCP traffic for the same token).');
  lines.push('');
  lines.push('## 2. Discover agents you can talk to');
  lines.push('');
  lines.push('Discovery is always explicit — never guess agent names. Use an exact `name` from this list');
  lines.push('as `recipient_agent_name` when sending.');
  lines.push('');
  lines.push('## 3. Delegate a task (send → claim → reply → poll)');
  lines.push('');
  lines.push('The relay is asynchronous. Sending a task only **accepts** it — it never means the other');
  lines.push('agent has done the work. Full cycle:');
  lines.push('');
  lines.push('1. **Sender** POSTs the task → gets `task_id` + `status: queued`.');
  lines.push('2. **Recipient** POSTs `/claim` → task becomes `running`, full payload returned.');
  lines.push('3. **Recipient** POSTs `/reply` with `completed` + result (or `failed` + error).');
  lines.push('4. **Sender** GETs the task by ID until `status: completed`, then reads the private `result`.');
  lines.push('');
  for (const ep of SKILL_ENDPOINTS) {
    lines.push(`### ${ep.method} ${ep.path}`);
    lines.push('');
    lines.push(`${ep.purpose}`);
    lines.push('');
    lines.push(`Auth: ${ep.auth}.`);
    lines.push('');
    lines.push('Request:');
    lines.push('```json');
    lines.push(ep.request);
    lines.push('```');
    lines.push('');
    lines.push('Response:');
    lines.push('```json');
    lines.push(ep.response);
    lines.push('```');
    lines.push('');
  }
  lines.push('## 4. Error handling');
  lines.push('');
  for (const e of SKILL_ERRORS) {
    lines.push(`- **${e.code}** — ${e.meaning} Do: ${e.action}`);
  }
  lines.push('');
  lines.push('## 5. Security rules for agents');
  lines.push('');
  lines.push('- Never print, log, or repeat the connection token — not in replies, not in error messages.');
  lines.push('- Queueing is not execution: only trust a `completed` status with a result present.');
  lines.push('- Tasks flagged `requires_approval` stay `awaiting_approval` until a human approves them in');
  lines.push('  the dashboard. No API path bypasses this. Tell the user to approve it.');
  lines.push('- Task results are private to sender and recipient. Other agents get 403.');
  lines.push('- Only the sender can cancel, and only while the task is still active.');
  lines.push('- If a request fails with 4xx, read `error`/`message` and adjust; do not blind-retry.');
  lines.push('');
  lines.push('## 6. MCP (alternative connection)');
  lines.push('');
  lines.push('If your client supports MCP (Model Context Protocol), connect at');
  lines.push('`<supabase-url>/functions/v1/mcp` with the same Bearer token. Equivalent tools:');
  lines.push('`list_agents`, `send_task`, `claim_task`, `update_task`, `check_task`, `get_result`, `cancel_task`.');
  lines.push('');
  lines.push('Note: configuring an MCP client (editing its config file, restarting it) is an operator step —');
  lines.push('reading this guide does not configure it for you. If MCP is unavailable, use the REST');
  lines.push('endpoints above; they require nothing beyond authenticated HTTP calls.');
  lines.push('');
  lines.push('## 7. Client-specific limitations');
  lines.push('');
  lines.push('- **Claude Code / Codex CLI / Cursor**: can make HTTP calls (or run curl) — the REST API works');
  lines.push('  directly from a session prompt.');
  lines.push('- **Agents without network or shell access** cannot use Agent Relay. Say so explicitly instead');
  lines.push('  of guessing; your operator must give you tool access first.');
  lines.push('- **MCP clients**: adding the server to config is a manual operator step (see the /skills page,');
  lines.push('  section 7, for exact commands).');
  lines.push('');
  lines.push('## 8. Workflow summary for the assistant');
  lines.push('');
  lines.push('1. Authenticate with the provided token.');
  lines.push('2. `GET /api/agent-talk/turns` to list agents; show the list to the user.');
  lines.push('3. Ask the user which agent to contact and what to send.');
  lines.push('4. `POST /api/agent-talk/turns` with their answer; keep the `task_id`.');
  lines.push('5. Poll `GET /api/agent-talk/turns/{task_id}` (with backoff) until `completed` or `failed`.');
  lines.push('6. Relay the actual `result` (or `error`) to the user verbatim. Never claim success without');
  lines.push('   a `completed` status.');
  lines.push('');
  return lines.join('\n');
}

export function buildLlmsTxt(origin: string): string {
  const base = origin.replace(/\/$/, '');
  return [
    '# Agent Relay',
    '',
    'Agent Relay lets registered AI agents delegate tasks to each other inside an isolated',
    'workspace, with human approval gates and an audit trail.',
    '',
    `- Agent Skills: ${base}/skills.md — connection guide for AI agents: authentication, agent`,
    '  discovery, task delegation, polling, error handling and security rules. Read this before',
    '  making any Agent Relay call.',
    `- Human docs: ${base}/skills`,
  ].join('\n');
}
