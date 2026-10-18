'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, KeyRound, Trash2, Copy, CheckCircle2, XCircle, PlugZap, Sparkles, ExternalLink } from 'lucide-react';
import type { Agent, AgentToken } from '@/lib/types';

function formatWhen(iso: string | null) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const router = useRouter();
  const { toast } = useToast();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [testToken, setTestToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [{ data: a, error: aErr }, { data: t, error: tErr }] = await Promise.all([
      supabase.from('agents').select('*').eq('id', agentId).maybeSingle(),
      supabase.from('agent_tokens').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }),
    ]);
    if (aErr || !a) {
      router.replace('/agents');
      return;
    }
    setAgent(a);
    if (!tErr) setTokens(t ?? []);
    setLoading(false);
  }, [agentId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setNewToken(null);
    const res = await fetch('/api/agent-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    });
    const body = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok || !body.token) {
      toast({ title: 'Could not generate token', description: body.error ?? 'Try again.', variant: 'destructive' });
      return;
    }
    setNewToken(body.token as string);
    setShowSetup(true);
    load();
  }

  async function handleRevoke(tokenId: string) {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase
      .from('agent_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .is('revoked_at', null);
    if (error) {
      toast({ title: 'Could not revoke token', description: error.message, variant: 'destructive' });
      return;
    }
    load();
    toast({ title: 'Token revoked', description: 'The agent can no longer authenticate with it.' });
  }

  async function handleTestConnection() {
    if (!testToken.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/connection-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: testToken.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (body && typeof body.message === 'string') {
        setTestResult({ ok: body.ok === true, message: body.message });
      } else {
        setTestResult({ ok: false, message: 'Unexpected response — please try again.' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Could not run the test — check your connection and retry.' });
    }
    setTesting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const skillsUrl = `${origin}/skills.md`;
  const skillsPageUrl = `${origin}/skills`;
  const mcpUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp`;
  const connectPrompt = `Please read the Agent Skills guide at ${skillsUrl} (plain Markdown, readable with a simple GET) and act as my Agent Relay assistant for this workspace.

My connection details:
- Workspace ID: ${agent.workspace_id} (informational — my token is already scoped to this workspace)
- Agent ID: ${agent.id}
- Token: the token I gave you (pass it on every request as an Authorization header: "Authorization: Bearer <token>")

Your job:
1. Fetch and read the skill guide, then list the agents I'm allowed to contact (GET ${origin}/api/agent-talk/turns).
2. Show me the list and ask which agent I want to talk to and what to send.
3. Send my task (POST ${origin}/api/agent-talk/turns), then poll GET ${origin}/api/agent-talk/turns/{task_id} until status is "completed" or "failed".
4. Relay the actual response (or error) back to me verbatim.

Rules: never print or store my token anywhere; never claim a task succeeded unless its status is "completed" with a result; if the task is "awaiting_approval", tell me to approve it in the Agent Relay dashboard. If you cannot make HTTP requests, tell me exactly how to set things up instead of guessing.`;

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        'agent-relay': {
          url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp`,
          headers: { Authorization: 'Bearer <YOUR_AGENT_RELAY_TOKEN>' },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
        {agent.description && <p className="text-sm text-muted-foreground">{agent.description}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect via MCP</CardTitle>
          <CardDescription>
            Point any MCP-compatible client at the Agent Relay endpoint using this agent&apos;s token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Endpoint URL</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3 font-mono text-xs break-all">
              <span className="flex-1">{process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => {
                  navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp`);
                  toast({ title: 'Endpoint copied' });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Test a connection token</p>
            <p className="text-xs text-muted-foreground">
              Paste a token for this agent to verify it connects before touching your MCP client.
            </p>
            <div className="flex gap-2">
              <Input
                value={testToken}
                onChange={(e) => {
                  setTestToken(e.target.value);
                  setTestResult(null);
                }}
                placeholder="ar_…"
                className="font-mono text-xs"
                autoComplete="off"
              />
              <Button variant="outline" onClick={handleTestConnection} disabled={testing || !testToken.trim()}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Test
              </Button>
            </div>
            {testResult && (
              <p
                role="status"
                className={`text-sm ${testResult.ok ? 'text-emerald-700' : 'text-red-700'}`}
              >
                {testResult.ok ? <CheckCircle2 className="mr-1 inline h-4 w-4" /> : <XCircle className="mr-1 inline h-4 w-4" />}
                {testResult.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Client configuration</p>
            <pre className="rounded-md border bg-muted/50 p-3 font-mono text-xs overflow-x-auto whitespace-pre">
              {mcpConfig}
            </pre>
            <p className="text-xs text-muted-foreground">
              Replace <code>&lt;YOUR_AGENT_RELAY_TOKEN&gt;</code> with a token you generate below.
              The token is shown once at creation — if lost, generate a new one.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Available tools</p>
            <ul className="list-inside list-disc text-sm text-muted-foreground space-y-1">
              <li><code className="text-foreground">get_started</code> — identity, workspace and workflow guide (call once when connecting)</li>
              <li><code className="text-foreground">list_agents</code> — list agents in the workspace</li>
              <li><code className="text-foreground">send_task</code> — delegate a task to another agent in this workspace</li>
              <li><code className="text-foreground">claim_task</code> — claim the next queued task addressed to you</li>
              <li><code className="text-foreground">update_task</code> — report running, completed (with result) or failed (with error)</li>
              <li><code className="text-foreground">check_task</code> — check status, result and error of a task</li>
              <li><code className="text-foreground">get_result</code> — fetch a completed task&apos;s result</li>
              <li><code className="text-foreground">cancel_task</code> — cancel a task you sent</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Your first delegation in 4 steps</p>
            <ol className="list-inside list-decimal text-sm text-muted-foreground space-y-1">
              <li>Save the configuration above into your first MCP client (this agent — the sender).</li>
              <li>Add a second agent under <b>Agents</b>, generate its token, and connect a second MCP client the same way.</li>
              <li>From the sender, call <code className="text-foreground">send_task</code> with the second agent&apos;s name as <code className="text-foreground">recipient_agent_name</code>.</li>
              <li>From the second client, call <code className="text-foreground">claim_task</code>, do the work, then <code className="text-foreground">update_task</code> with the result. The sender fetches it with <code className="text-foreground">get_result</code>.</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Connection tokens</CardTitle>
            <CardDescription>Scoped, revocable tokens that authenticate this agent.</CardDescription>
          </div>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            Generate token
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {newToken && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800">
                Copy this token now — it will not be shown again.
              </p>
              <div className="font-mono text-xs break-all select-all text-amber-900">{newToken}</div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(newToken);
                  toast({ title: 'Token copied' });
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          )}

          {showSetup && newToken && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Sparkles className="h-5 w-5" /> Connect this agent
                </CardTitle>
                <CardDescription>
                  Copy the prompt below and paste it into your AI agent (Claude Code, Codex, any assistant that
                  can make HTTP calls). It will read the skill guide, authenticate, and ask you who to talk to.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Workspace ID', value: agent.workspace_id },
                    { label: 'Agent ID', value: agent.id },
                    { label: 'Skill guide URL', value: skillsUrl },                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-md border bg-background p-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-xs break-all flex-1 min-w-0">{value}</code>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          aria-label={`Copy ${label}`}
                          onClick={() => {
                            navigator.clipboard.writeText(value);
                            toast({ title: `${label} copied` });
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Ready-to-paste connection prompt</p>
                    <Button
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(connectPrompt);
                        toast({ title: 'Prompt copied', description: 'Paste it into your AI agent.' });
                      }}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy prompt
                    </Button>
                  </div>
                  <pre className="rounded-md border bg-background p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto">
                    {connectPrompt}
                  </pre>
                </div>

                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                  <p className="font-medium">Token security</p>
                  <p>
                    The token above is shown <b>only this once</b> — it is stored as a hash and cannot be retrieved
                    again. Never paste it into shared documents, chat messages, or public pages. If it leaks,
                    revoke it from the token list below and generate a new one.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground">
                  The prompt references the live, public skill guide —{' '}
                  <a href={skillsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                    open it to see exactly what your agent will read <ExternalLink className="h-3 w-3" />
                  </a>.
                </p>
              </CardContent>
            </Card>
          )}

          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tokens yet. Generate one to let this agent connect.
            </p>
          ) : (            <ul className="divide-y">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono">{t.token_prefix}…</code>
                      {t.revoked_at ? (
                        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                          <XCircle className="mr-1 h-3 w-3" /> Revoked
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Created {formatWhen(t.created_at)} · Last used {formatWhen(t.last_used_at)}
                    </p>
                  </div>
                  {!t.revoked_at && (
                    <Button size="sm" variant="destructive" onClick={() => handleRevoke(t.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
