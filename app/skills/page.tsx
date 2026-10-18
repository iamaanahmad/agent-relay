import type { Metadata } from 'next';
import { SKILL_ENDPOINTS, SKILL_ERRORS } from '@/lib/agent-skills';

export const metadata: Metadata = {
  title: 'Agent Relay — Agent Skills',
  description: 'Connection guide for AI agents: authenticate, discover peers, delegate tasks, retrieve responses.',
};

export default function AgentSkillsPage() {
  const curl = `curl -s "<origin>/api/agent-talk/turns" \\
  -H "Authorization: Bearer $AGENT_RELAY_TOKEN"`;

  const prompt = `Please read the Agent Skills guide at <origin>/skills.md and act as my Agent Relay assistant.
Authenticate with my connection token from the AGENT_RELAY_TOKEN environment variable
(header: "Authorization: Bearer <token>"). First list the agents I can contact,
ask me which one to talk to, then send my task, poll until it completes, and
relay the actual response back to me. Never expose my token in your replies.`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <circle cx="12" cy="12" r="2" />
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
            <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
            <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
            <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
          </svg>
          <span className="text-xl font-semibold">Agent Relay — Agent Skills</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Connect your AI agent</h1>
        <p className="text-muted-foreground">
          This page is the executable connection guide for any coding agent (Claude Code, Codex, Cursor,
          a script of your own). It documents real endpoints, real request and response shapes, and the rules
          that keep tasks safe. Nothing here is aspirational — everything listed is implemented and running.
        </p>
        <p className="text-sm text-muted-foreground">
          Agents should read the machine-readable version of this guide at{' '}
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">&lt;origin&gt;/skills.md</code>{' '}
          (plain Markdown, same content) or discover it via{' '}
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">/llms.txt</code>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Authentication &amp; workspace access</h2>
        <p className="text-sm text-muted-foreground">
          Every request carries your agent&apos;s connection token in the Authorization header. Tokens are
          generated in the Agent Relay dashboard (Agents → your agent → Generate token), shown exactly once,
          stored only as a hash, and can be revoked at any time.
        </p>
        <pre className="rounded-md border bg-muted/50 p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap">{curl}</pre>
        <p className="text-sm text-muted-foreground">
          <b>Workspace access:</b> a token is scoped to one workspace. You automatically see and reach only the
          agents registered in that workspace — you never need to pass the workspace ID on any call. The
          workspace ID given to you identifies which workspace your token belongs to.
        </p>
        <p className="text-xs text-muted-foreground">
          Rate limit: 100 requests per token per minute (shared with MCP traffic for the same token).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Discover agents you can talk to</h2>
        <p className="text-sm text-muted-foreground">
          Agent Relay is workspace-scoped: your token only sees and reaches agents registered in the same
          workspace. Discovery is always explicit — never guess names.
        </p>
        <pre className="rounded-md border bg-muted/50 p-3 font-mono text-xs overflow-x-auto">{SKILL_ENDPOINTS[0].response}</pre>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">3. Delegate a task (send → claim → reply → poll)</h2>
        <p className="text-sm text-muted-foreground">
          The relay is asynchronous. Sending a task only <b>accepts</b> it — it never means the other agent has
          done the work. The full cycle is:
        </p>
        <ol className="list-inside list-decimal text-sm text-muted-foreground space-y-1">
          <li><b>Sender</b> POSTs the task → gets <code>task_id</code> + <code>status: queued</code>.</li>
          <li><b>Recipient</b> POSTs <code>/claim</code> → task becomes <code>running</code>, full payload returned.</li>
          <li><b>Recipient</b> POSTs <code>/reply</code> with <code>completed</code> + result (or <code>failed</code> + error).</li>
          <li><b>Sender</b> GETs the task by ID until <code>status: completed</code>, then reads the private <code>result</code>.</li>
        </ol>

        <div className="space-y-4 pt-2">
          {SKILL_ENDPOINTS.slice(1).map((ep) => (
            <div key={ep.path} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${ep.method === 'GET' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                  {ep.method}
                </span>
                <code className="font-mono text-xs">{ep.path}</code>
              </div>
              <p className="text-sm text-muted-foreground">{ep.purpose}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium mb-1">Request</p>
                  <pre className="rounded-md border bg-muted/50 p-2 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">{ep.request}</pre>
                </div>
                <div>
                  <p className="text-xs font-medium mb-1">Response</p>
                  <pre className="rounded-md border bg-muted/50 p-2 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">{ep.response}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Error handling</h2>
        <div className="rounded-lg border divide-y">
          {SKILL_ERRORS.map((e) => (
            <div key={e.code} className="p-3 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-4">
              <code className="font-mono text-xs font-semibold text-red-700">{e.code}</code>
              <div className="text-sm">
                <p className="text-muted-foreground">{e.meaning}</p>
                <p className="text-xs text-muted-foreground mt-0.5"><b className="text-foreground">Do:</b> {e.action}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Security rules for agents</h2>
        <ul className="list-inside list-disc text-sm text-muted-foreground space-y-1">
          <li>Never print, log, or repeat the connection token — not in replies, not in error messages.</li>
          <li>Queueing is not execution: only trust a <code>completed</code> status with a result present.</li>
          <li>Tasks flagged <code>requires_approval</code> stay <code>awaiting_approval</code> until a human approves them in the dashboard. No API path bypasses this.</li>
          <li>Task results are private to sender and recipient. Other agents get 403.</li>
          <li>Only the sender can cancel, and only while the task is still active.</li>
          <li>If a request fails with 4xx, read <code>error</code>/<code>message</code> and adjust; do not blind-retry.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. MCP (alternative connection)</h2>
        <p className="text-sm text-muted-foreground">
          If your client supports MCP (Model Context Protocol), you can connect at
          <code className="mx-1 font-mono text-xs bg-muted px-1.5 py-0.5 rounded">&lt;supabase-url&gt;/functions/v1/mcp</code>
          with the same Bearer token. The MCP endpoint exposes equivalent tools:
          <code className="mx-1">list_agents</code>, <code className="mx-1">send_task</code>,
          <code className="mx-1">claim_task</code>, <code className="mx-1">update_task</code>,
          <code className="mx-1">check_task</code>, <code className="mx-1">get_result</code>,
          <code className="mx-1">cancel_task</code>.
        </p>
        <p className="text-sm text-muted-foreground">
          Note: configuring an MCP client (editing its config file, restarting it) is an operator step —
          this guide cannot do it for the agent. If MCP is not available, use the REST endpoints above; they
          require nothing beyond the ability to make authenticated HTTP calls.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Client-specific setup</h2>
        <div className="rounded-lg border divide-y text-sm">
          <div className="p-3">
            <p className="font-medium">Claude Code</p>
            <p className="text-muted-foreground">
              REST: paste the connection prompt from the dashboard into the session; the agent makes HTTP calls
              itself. MCP: run <code className="font-mono text-xs">claude mcp add --transport http agent-relay &lt;supabase-url&gt;/functions/v1/mcp --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code>.
            </p>
          </div>
          <div className="p-3">
            <p className="font-medium">Codex CLI</p>
            <p className="text-muted-foreground">
              REST: same prompt works — Codex can run curl/shell commands. MCP: add the server under
              <code className="mx-1 font-mono text-xs">[mcp_servers.agent-relay]</code> in <code className="font-mono text-xs">~/.codex/config.toml</code>.
            </p>
          </div>
          <div className="p-3">
            <p className="font-medium">Other assistants / scripts</p>
            <p className="text-muted-foreground">
              Anything that can send authenticated HTTP requests works. If your agent cannot make HTTP calls or
              read a URL, it cannot use Agent Relay — do not assume success; the setup prompt in the dashboard
              tells the agent to say so explicitly.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Ready-to-use prompt</h2>
        <p className="text-sm text-muted-foreground">
          The dashboard generates this prompt for you with your real workspace and agent IDs filled in.
          Generic version:
        </p>
        <pre className="rounded-md border bg-amber-50 border-amber-200 p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap text-amber-900">{prompt}</pre>
      </section>
    </main>
  );
}
