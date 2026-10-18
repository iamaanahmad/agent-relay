import { authenticateAgent, enforceRateLimit, touchToken, expireStaleTasks, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// Retrieve a task's status and, when completed, its private result.
// Only the sender, the assigned recipient, or the workspace owner (via the
// dashboard) may see a task; results are only included for participants.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);

  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);
  await expireStaleTasks(auth);

  const taskId = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return Response.json({ error: 'invalid_task_id' }, { status: 400 });
  }

  const { data: task, error } = await auth.supabase
    .from('tasks')
    .select('id, sender_agent_id, recipient_agent_id, title, status, requires_approval, result, error, created_at, updated_at, completed_at')
    .eq('id', taskId)
    .eq('workspace_id', auth.workspaceId)
    .maybeSingle();
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!task) return Response.json({ error: 'task_not_found' }, { status: 404 });

  const isSender = task.sender_agent_id === auth.agentId;
  const isRecipient = task.recipient_agent_id === auth.agentId;
  if (!isSender && !isRecipient) {
    return Response.json({ error: 'forbidden', message: 'Only the sender or the assigned recipient can view this task.' }, { status: 403 });
  }

  const status = task.status;
  if (status === 'awaiting_approval') {
    return Response.json({
      task_id: task.id, title: task.title, status,
      note: 'Waiting for a human to approve this task in the dashboard. It will move to queued once approved.',
    });
  }
  if (status === 'completed') {
    return Response.json({
      task_id: task.id, title: task.title, status,
      result: task.result, error: null, created_at: task.created_at, updated_at: task.updated_at, completed_at: task.completed_at,
    });
  }
  return Response.json({
    task_id: task.id, title: task.title, status,
    error: task.error ?? null,
    created_at: task.created_at, updated_at: task.updated_at, completed_at: task.completed_at ?? null,
  });
}
