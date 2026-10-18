'use client';

import { useTaskEvents } from '@/lib/hooks';
import { useWorkspace } from '@/components/workspace-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollText } from 'lucide-react';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function ActivityPage() {
  const { activeWorkspace } = useWorkspace();
  const { events, loading } = useTaskEvents();

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Create a workspace first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Immutable audit trail of task creation, approvals, completions and cancellations.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ScrollText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm">
              Nothing has happened in this workspace yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ol className="relative space-y-4 border-l pl-6">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[1.72rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
              <p className="text-sm font-medium">{e.event_type.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">
                {e.actor} · {formatWhen(e.created_at)}
              </p>
              {Object.keys(e.detail ?? {}).length > 0 && (
                <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(e.detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
