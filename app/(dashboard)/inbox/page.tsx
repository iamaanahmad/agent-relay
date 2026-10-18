'use client';

import { useState } from 'react';
import { useTasks, useAgents } from '@/lib/hooks';
import { useWorkspace } from '@/components/workspace-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Inbox, ArrowRight, ArrowLeft, Clock } from 'lucide-react';
import type { Task, TaskStatus } from '@/lib/types';

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InboxPage() {
  const { activeWorkspace } = useWorkspace();
  const { agents } = useAgents();
  const { tasks, loading, refresh } = useTasks(15000);
  const [selected, setSelected] = useState<Task | null>(null);
  const [cancelling, setCancelling] = useState(false);

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>Create a workspace first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? (id ? 'unknown agent' : 'you');

  async function handleCancel(task: Task) {
    setCancelling(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq('id', task.id)
      .in('status', ['awaiting_approval', 'queued', 'running']);
    setCancelling(false);
    if (error) {
      setSelected(null);
      refresh();
      return;
    }
    refresh();
    setSelected(null);
  }

  const grouped: { key: string; label: string; statuses: TaskStatus[] }[] = [
    { key: 'received', label: 'Received by agents', statuses: ['awaiting_approval', 'queued', 'running', 'completed', 'failed', 'cancelled'] },
    { key: 'sent', label: 'Sent by you', statuses: [] },
  ];
  const sentTasks = tasks.filter((t) => t.sender_agent_id === null);
  const agentTasks = tasks.filter((t) => t.sender_agent_id !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Tasks delegated between agents and by you in {activeWorkspace.name}.
        </p>
      </div>

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="received">Agent tasks ({agentTasks.length})</TabsTrigger>
          <TabsTrigger value="sent">Sent by you ({sentTasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="mt-4">
          <TaskList tasks={agentTasks} loading={loading} onSelect={setSelected} agentName={agentName} emptyHint="No agent-to-agent tasks yet. Connect two agents and send one a task from the other." />
        </TabsContent>
        <TabsContent value="sent" className="mt-4">
          <TaskList tasks={sentTasks} loading={loading} onSelect={setSelected} agentName={agentName} emptyHint="You haven't sent any tasks directly. Use the Send task page in the left navigation to delegate work to one of your agents." />
        </TabsContent>
      </Tabs>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3 pr-6">
                  <span className="flex-1">{selected.title}</span>
                  <StatusBadge status={selected.status} />
                </DialogTitle>
                <DialogDescription>
                  {agentName(selected.sender_agent_id)} → {agentName(selected.recipient_agent_id)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <section>
                  <h3 className="font-medium mb-1">Instructions</h3>
                  <p className="whitespace-pre-wrap text-muted-foreground">{selected.instructions}</p>
                </section>

                {Object.keys(selected.context ?? {}).length > 0 && (
                  <section>
                    <h3 className="font-medium mb-1">Context</h3>
                    <pre className="rounded-md border bg-muted/50 p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(selected.context, null, 2)}
                    </pre>
                  </section>
                )}

                {selected.result && (
                  <section>
                    <h3 className="font-medium mb-1">Result</h3>
                    <pre className="rounded-md border bg-emerald-50 p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(selected.result, null, 2)}
                    </pre>
                  </section>
                )}

                {selected.error && (
                  <section>
                    <h3 className="font-medium mb-1 text-red-700">Error</h3>
                    <p className="whitespace-pre-wrap rounded-md border bg-red-50 p-3 text-xs text-red-800">
                      {selected.error}
                    </p>
                  </section>
                )}

                <section className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Created {formatWhen(selected.created_at)}</span>
                  <span>Approved {formatWhen(selected.approved_at)}</span>
                  <span>Updated {formatWhen(selected.updated_at)}</span>
                  <span>Completed {formatWhen(selected.completed_at)}</span>
                </section>

                {['awaiting_approval', 'queued', 'running'].includes(selected.status) && (
                  <Button variant="destructive" size="sm" onClick={() => handleCancel(selected)} disabled={cancelling}>
                    {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Cancel task
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskList({ tasks, loading, onSelect, agentName, emptyHint }: {
  tasks: Task[];
  loading: boolean;
  onSelect: (t: Task) => void;
  agentName: (id: string | null) => string;
  emptyHint: string;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading tasks…</p>;
  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-sm">{emptyHint}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => onSelect(t)}
            className="w-full text-left rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowLeft className="h-3 w-3 hidden" />
                  {agentName(t.sender_agent_id)} <ArrowRight className="h-3 w-3" /> {agentName(t.recipient_agent_id)}
                  <span>· {formatWhen(t.created_at)}</span>
                </p>
              </div>
              <StatusBadge status={t.status} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
