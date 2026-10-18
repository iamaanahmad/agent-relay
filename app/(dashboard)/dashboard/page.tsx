'use client';

import Link from 'next/link';
import { useAgents } from '@/lib/hooks';
import { useTasks } from '@/lib/hooks';
import { useTaskEvents } from '@/lib/hooks';
import { useWorkspace } from '@/components/workspace-provider';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plug, Inbox, ShieldCheck, ScrollText, ArrowRight, Plus } from 'lucide-react';
import type { TaskStatus } from '@/lib/types';

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function DashboardPage() {
  const { activeWorkspace } = useWorkspace();
  const { agents, loading: agentsLoading } = useAgents();
  const { tasks, loading: tasksLoading } = useTasks();
  const { events, loading: eventsLoading } = useTaskEvents();

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Welcome to Agent Relay</CardTitle>
          <CardDescription>
            Create your first workspace using the workspace menu at the top to get started.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pending = tasks.filter((t) => t.status === 'awaiting_approval');
  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'running');
  const recentTasks = tasks.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of {activeWorkspace.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard href="/agents" icon={Plug} label="Connected agents" value={agents.length} loading={agentsLoading} />
        <StatCard href="/inbox" icon={Inbox} label="Tasks (all)" value={tasks.length} loading={tasksLoading} />
        <StatCard href="/approvals" icon={ShieldCheck} label="Pending approvals" value={pending.length} loading={tasksLoading} highlight={pending.length > 0} />
        <StatCard href="/inbox" icon={ScrollText} label="Active tasks" value={active.length} loading={tasksLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent tasks</CardTitle>
              <CardDescription>Latest delegated work in this workspace</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/inbox">
                View all <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {tasksLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : recentTasks.length === 0 ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No tasks yet. Register two agents, then delegate from the Send task page or from an agent's MCP client.
                </p>
                <Button asChild size="sm">
                  <Link href="/agents">
                    <Plus className="mr-2 h-4 w-4" /> Add an agent
                  </Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {recentTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{formatWhen(t.created_at)}</p>
                    </div>
                    <StatusBadge status={t.status as TaskStatus} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Audit trail of workspace events</CardDescription>
          </CardHeader>
          <CardContent>
            {eventsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
            ) : (
              <ul className="space-y-3">
                {events.slice(0, 8).map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.event_type.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground"> — {e.actor}</span>
                    <p className="text-xs text-muted-foreground">{formatWhen(e.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ href, icon: Icon, label, value, loading, highlight }: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className={`transition-colors hover:bg-muted/40 ${highlight ? 'border-amber-300' : ''}`}>
        <CardContent className="flex items-center gap-4 p-5">
          <div className="rounded-md bg-primary/10 p-2.5">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold">{loading ? '…' : value}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
