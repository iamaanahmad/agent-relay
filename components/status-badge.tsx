import { Badge } from '@/components/ui/badge';
import type { TaskStatus } from '@/lib/types';

const STYLES: Record<TaskStatus, { label: string; className: string }> = {
  awaiting_approval: { label: 'Awaiting approval', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  queued: { label: 'Queued', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  running: { label: 'Running', className: 'bg-violet-100 text-violet-800 border-violet-200' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-700 border-zinc-200' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STYLES[status] ?? STYLES.cancelled;
  return (
    <Badge variant="outline" className={s.className}>
      {s.label}
    </Badge>
  );
}
