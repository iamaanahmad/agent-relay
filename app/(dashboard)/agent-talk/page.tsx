'use client';

import { useState } from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { MessageSquareText, Copy, Check } from 'lucide-react';
import { useEffect } from 'react';
import type { Agent } from '@/lib/types';

function CopyBlock({ label, text }: { label: string; text: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast({ title: 'Copied to clipboard' });
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      <pre className="rounded-md border bg-muted/50 p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

export default function AgentTalkPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    if (!activeWorkspace) return;
    const supabase = getSupabaseBrowserClient();
    supabase.from('agents').select('*').eq('workspace_id', activeWorkspace.id).order('name')
      .then(({ data }) => setAgents(data ?? []));
  }, [activeWorkspace]);

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent Talk</CardTitle>
          <CardDescription>Create a workspace first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const sender = agents[0]?.name ?? 'coordinator';
  const worker = agents[1]?.name ?? 'worker';

  const skillGuide = `# Agent Talk skill — how to exchange tasks with other agents

You can delegate work to other registered agents and pick up work assigned to
you using the Agent Talk REST API. Authenticate every request with:

  Authorization: Bearer <YOUR_AGENT_TALK_TOKEN>

All request and response bodies are JSON.

## Discover who you can talk to
GET ${origin}/api/agent-talk/turns
→ { "agents": [{ "id", "name", "description" }] }

## Send a task to another agent
POST ${origin}/api/agent-talk/turns
Body:
{
  "recipient_agent_name": "${worker}",
  "title": "Summarise the Q3 notes",
  "instructions": "Read the attached context and return a 5-bullet summary.",
  "context": { "source": "q3-notes.md" }
}
Optional: "requires_approval": true (a human must approve in the dashboard
before it runs), "timeout_minutes": 60, "idempotency_key": "your-unique-key".
Response (201): { "task_id": "…", "status": "queued", ... }
The status only means ACCEPTED — it does not mean the other agent has done
the work. Poll the GET endpoint until status becomes "completed".

## Pick up work assigned to you
Claim a queued task (only the assigned recipient can):
POST ${origin}/api/agent-talk/turns/{task_id}/claim
→ { "task": { "id", "title", "instructions", "context", "status": "running" } }

## Reply with the result
Only after claiming, when you are done:
POST ${origin}/api/agent-talk/turns/{task_id}/reply
Body (success): { "status": "completed", "result": { "summary": "…" } }
Body (failure): { "status": "failed", "error": "what went wrong" }
→ { "task_id": "…", "status": "completed" }

## Check on a task you sent
GET ${origin}/api/agent-talk/turns/{task_id}
→ { "task_id", "title", "status", "result", "error", ... }
The private result is only visible to the sender and the recipient.

## Cancel a task you sent (while it is still active)
POST ${origin}/api/agent-talk/turns/{task_id}/cancel
→ { "task_id": "…", "status": "cancelled" }

## Rules
- One claim per task; a task must be claimed before it can be replied to.
- Tasks awaiting human approval cannot be claimed until approved.
- Rate limit: 100 requests per minute per token.
- If a request fails with 4xx, read the "error" and "message" fields; they are
  safe to surface to the user.`;

  const curlExamples = `# 1. List agents you can address
curl -s "${origin}/api/agent-talk/turns" \\
  -H "Authorization: Bearer $AGENT_TALK_TOKEN"

# 2. Send a task
curl -s -X POST "${origin}/api/agent-talk/turns" \\
  -H "Authorization: Bearer $AGENT_TALK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"recipient_agent_name":"${worker}","title":"Summarise notes","instructions":"Return 5 bullets."}'

# 3. Recipient claims the task
curl -s -X POST "${origin}/api/agent-talk/turns/$TASK_ID/claim" \\
  -H "Authorization: Bearer $WORKER_TOKEN"

# 4. Recipient submits the result
curl -s -X POST "${origin}/api/agent-talk/turns/$TASK_ID/reply" \\
  -H "Authorization: Bearer $WORKER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"completed","result":{"summary":"..."}}'

# 5. Sender polls for the result
curl -s "${origin}/api/agent-talk/turns/$TASK_ID" \\
  -H "Authorization: Bearer $AGENT_TALK_TOKEN"`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Talk</h1>
        <p className="text-sm text-muted-foreground">
          A simple REST API for delegating tasks between your agents — same tokens, tasks, approvals and audit
          trail as MCP, no MCP client required.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
          <CardDescription>
            Agents authenticate with the same connection tokens generated on each agent&apos;s page
            (Agents&nbsp;→ Connect). Sending a task returns immediately with a task ID; the recipient claims it,
            does the work, and replies. You poll with the task ID until the result is in.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground">1. Submit</p>
            <p className="mt-1">POST the task to a recipient by name. You get a task ID and status right away.</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground">2. Claim</p>
            <p className="mt-1">The recipient claims the task, which reserves it and returns full instructions.</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground">3. Reply</p>
            <p className="mt-1">The recipient submits a completed result or a failure reason.</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground">4. Poll</p>
            <p className="mt-1">You fetch the task by ID to read the status and private result.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoint &amp; authentication</CardTitle>
          <CardDescription>
            Base URL and header used by every Agent Talk request.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyBlock label="Base URL" text={`${origin}/api/agent-talk`} />
          <CopyBlock label="Auth header" text={`Authorization: Bearer <YOUR_AGENT_TALK_TOKEN>`} />
          <p className="text-xs text-muted-foreground">
            Tokens are workspace-scoped, shown once when generated, stored only as hashes, and can be revoked at any
            time from the agent&apos;s page. Rate limit: 100 requests per token per minute.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>All bodies and responses are JSON.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">POST /api/agent-talk/turns</code> — submit a task to <code>recipient_agent_name</code>; returns <code>task_id</code> + <code>status</code> (queued or awaiting_approval). Supports <code>context</code>, <code>requires_approval</code>, <code>timeout_minutes</code>, <code>idempotency_key</code>.</li>
            <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">GET /api/agent-talk/turns</code> — list agents you can address in this workspace.</li>
            <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">GET /api/agent-talk/turns/&#123;id&#125;</code> — status, and the private <code>result</code> once completed (sender and recipient only).</li>
            <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">POST /api/agent-talk/turns/&#123;id&#125;/claim</code> — recipient claims a queued task; moves it to running and returns the full payload.</li>
            <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">POST /api/agent-talk/turns/&#123;id&#125;/reply</code> — recipient submits <code>&#123;&quot;status&quot;:&quot;completed&quot;,&quot;result&quot;:&#123;…&#125;&#125;</code> or <code>&#123;&quot;status&quot;:&quot;failed&quot;,&quot;error&quot;:&quot;…&quot;&#125;</code>. Requires the task to be claimed first.</li>
            <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">POST /api/agent-talk/turns/&#123;id&#125;/cancel</code> — sender cancels an active task (awaiting_approval, queued or running).</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Copyable examples</CardTitle>
          <CardDescription>
            Full workflow with {sender} sending to {worker}. Adjust the agent names to yours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs defaultValue="curl">
            <TabsList>
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="skill">Agent skill guide</TabsTrigger>
            </TabsList>
            <TabsContent value="curl" className="mt-3">
              <CopyBlock label="End-to-end workflow" text={curlExamples} />
            </TabsContent>
            <TabsContent value="skill" className="mt-3">
              <CopyBlock label="Give this to your agent (Codex, Claude Code, any scriptable assistant)" text={skillGuide} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Good to know</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><b className="text-foreground">Queueing is not execution.</b> A 201 response means the task was accepted — never that the recipient has done or will do the work. Treat the result as real only after the status is <code>completed</code>.</p>
          <p><b className="text-foreground">Approvals are enforced.</b> Tasks flagged <code>requires_approval</code> stay <code>awaiting_approval</code> (and cannot be claimed or replied to) until a human approves them on the Approvals page. The REST API cannot bypass this.</p>
          <p><b className="text-foreground">Private results.</b> Only the sender and the assigned recipient can read a task&apos;s status and result. Other agents in the workspace get 403.</p>
          <p><b className="text-foreground">Idempotent submissions.</b> Retrying the same send (or passing the same <code>idempotency_key</code>) returns the original task instead of creating a duplicate — safe to retry after a network error.</p>
          <p><b className="text-foreground">Same machinery as MCP.</b> Tasks submitted over Agent Talk appear in the Inbox, Approvals and Activity pages, honor timeouts, and can be answered by an agent connected via MCP and vice versa.</p>
        </CardContent>
      </Card>
    </div>
  );
}
