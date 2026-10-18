'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAgents } from '@/lib/hooks';
import { useWorkspace } from '@/components/workspace-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, KeyRound, Plug, Cable } from 'lucide-react';
import type { Agent } from '@/lib/types';

export default function AgentsPage() {
  const { activeWorkspace } = useWorkspace();
  const { agents, loading, refresh } = useAgents();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const [tokenAgent, setTokenAgent] = useState<Agent | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Create a workspace first from the menu at the top.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function handleAddAgent(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('agents')
      .insert({ workspace_id: activeWorkspace!.id, name: name.trim(), description: description.trim() })
      .select()
      .maybeSingle();
    setBusy(false);
    if (error || !data) {
      toast({ title: 'Could not create agent', description: error?.message, variant: 'destructive' });
      return;
    }
    setName('');
    setDescription('');
    setAddOpen(false);
    refresh();
    toast({ title: 'Agent created', description: `${data.name} is ready to connect.` });
  }

  async function handleGenerateToken(agent: Agent) {
    setTokenAgent(agent);
    setTokenBusy(true);
    setNewToken(null);
    const res = await fetch('/api/agent-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agent.id }),
    });
    const body = await res.json().catch(() => ({}));
    setTokenBusy(false);
    if (!res.ok || !body.token) {
      toast({
        title: 'Could not generate token',
        description: typeof body.error === 'string' ? body.error : 'Please try again.',
        variant: 'destructive',
      });
      return;
    }
    setNewToken(body.token as string);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Register the AI assistants that can send and receive tasks in {activeWorkspace.name}.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleAddAgent}>
              <DialogHeader>
                <DialogTitle>Add agent</DialogTitle>
                <DialogDescription>
                  Register an agent that supports MCP (Model Context Protocol). You will generate a
                  connection token next.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Agent name</Label>
                  <Input
                    id="agent-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Claude Desktop"
                    required
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-desc">Description (optional)</Label>
                  <Textarea
                    id="agent-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this agent used for?"
                    rows={3}
                    maxLength={500}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create agent
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading agents…</p>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Plug className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm">
              No agents yet. Add one to generate its connection token and configure it to talk to
              Agent Relay over MCP.
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add your first agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{a.name}</span>
                  <Badge variant="secondary">MCP</Badge>
                </CardTitle>
                {a.description && <CardDescription className="line-clamp-2">{a.description}</CardDescription>}
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleGenerateToken(a)}>
                  <KeyRound className="mr-2 h-4 w-4" /> New token
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/agents/${a.id}`}>
                    <Cable className="mr-2 h-4 w-4" /> Connect
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!tokenAgent} onOpenChange={(open) => !open && setTokenAgent(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connection token for {tokenAgent?.name}</DialogTitle>
            <DialogDescription>
              Copy this token now — it is shown only once and stored only as a hash on the server.
            </DialogDescription>
          </DialogHeader>
          {tokenBusy ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : newToken ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs break-all select-all">
                {newToken}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(newToken);
                  toast({ title: 'Token copied to clipboard' });
                }}
              >
                Copy token
              </Button>
              <p className="text-xs text-muted-foreground">
                Anyone holding this token can act as this agent inside the workspace. Treat it like a
                password.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
