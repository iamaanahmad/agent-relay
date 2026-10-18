import { authenticateAgent, enforceRateLimit, touchToken, logEvent, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// Cancel a task. Only the sender may cancel, and only while it is still
// active (awaiting_approval, queued or running) — same rules as MCP cancel_task.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);

  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);

  const taskId = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return Response.json({ error: 'invalid_task_id' }, { status: 400 });
  }

  const { data: task, error: tErr } = await auth.supabase
    .from('tasks')
    .select('id, status, sender_agent_id, title')
    .eq('id', taskId)
    .eq('workspace_id', auth.workspaceId)
    .maybeSingle();
  if (tErr) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!task) return Response.json({ error: 'task_not_found' }, { status: 404 });
  if (task.sender_agent_id !== auth.agentId) {
    return Response.json({ error: 'forbidden', message: 'Only the agent that sent a task can cancel it.' }, { status: 403 });
  }
  const cancellable = ['awaiting_approval', 'queued', 'running'];
  if (!cancellable.includes(task.status)) {
    return Response.json({ error: 'not_cancellable', message: `Task in status ${task.status} cannot be cancelled.` }, { status: 409 });
  }

  const { error: upErr } = await auth.supabase
    .from('tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
    .eq('id', task.id)
    .in('status', cancellable);
  if (upErr) return Response.json({ error: 'cancel_failed' }, { status: 500 });

  await logEvent(auth, task.id, 'cancelled', { by: 'sender agent' });
  return Response.json({ task_id: task.id, status: 'cancelled' });
}
