'use client';

import { useState } from 'react';
import { useTasks, useAgents } from '@/lib/hooks';
import { useWorkspace } from '@/components/workspace-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, Check, X, Loader2 } from 'lucide-react';
import type { Task } from '@/lib/types';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ApprovalsPage() {
  const { activeWorkspace } = useWorkspace();
  const { agents } = useAgents();
  const { tasks, loading, refresh } = useTasks(15000);
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approvals</CardTitle>
          <CardDescription>Create a workspace first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? (id ? 'unknown agent' : 'you');
  const pending = tasks.filter((t) => t.status === 'awaiting_approval');

  async function decide(task: Task, approve: boolean) {
    setBusyId(task.id);
    const supabase = getSupabaseBrowserClient();
    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('tasks')
      .update(
        approve
          ? { status: 'queued', approved_at: now, updated_at: now }
          : { status: 'cancelled', updated_at: now, completed_at: now },
      )
      .eq('id', task.id)
      .eq('status', 'awaiting_approval')
      .select()
      .maybeSingle();

    if (error || !updated) {
      setBusyId(null);
      toast({
        title: 'Could not update task',
        description: error?.message ?? 'It may have already been handled.',
        variant: 'destructive',
      });
      refresh();
      return;
    }

    await supabase.from('task_events').insert({
      task_id: task.id,
      workspace_id: task.workspace_id,
      event_type: approve ? 'approved' : 'rejected',
      actor: 'user',
      detail: { title: task.title },
    });

    setBusyId(null);
    refresh();
    toast({
      title: approve ? 'Task approved' : 'Task rejected',
      description: approve
        ? 'It is now queued for the receiving agent to pick up.'
        : 'The task has been cancelled and will not run.',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Tasks that agents requested but that will not run until you approve them.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm">
              No pending approvals. Agents mark tasks as requiring approval when they should not run
              without your explicit consent.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {pending.map((t) => (
            <li key={t.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{t.title}</CardTitle>
                      <CardDescription>
                        {agentName(t.sender_agent_id)} → {agentName(t.recipient_agent_id)} · {formatWhen(t.created_at)}
                      </CardDescription>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.instructions}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => decide(t, true)} disabled={busyId === t.id}>
                      {busyId === t.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(t, false)} disabled={busyId === t.id}>
                      <X className="mr-2 h-4 w-4" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
