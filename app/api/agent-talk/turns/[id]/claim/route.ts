import { authenticateAgent, enforceRateLimit, touchToken, expireStaleTasks, logEvent, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// Claim the task as the assigned recipient: atomically moves queued -> running.
// Claiming is NOT execution proof; it only reserves the work.
export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const { data: task, error: tErr } = await auth.supabase
    .from('tasks')
    .select('id, title, instructions, context, status, recipient_agent_id')
    .eq('id', taskId)
    .eq('workspace_id', auth.workspaceId)
    .maybeSingle();
  if (tErr) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!task) return Response.json({ error: 'task_not_found' }, { status: 404 });
  if (task.recipient_agent_id !== auth.agentId) {
    return Response.json({ error: 'forbidden', message: 'Only the assigned recipient can claim this task.' }, { status: 403 });
  }
  if (task.status === 'awaiting_approval') {
    return Response.json({ error: 'not_claimable', message: 'This task is awaiting human approval and cannot be claimed yet.' }, { status: 409 });
  }
  if (task.status !== 'queued') {
    return Response.json({ error: 'not_claimable', message: `Task is ${task.status}, not queued.` }, { status: 409 });
  }

  const { data: claimed, error: claimErr } = await auth.supabase
    .from('tasks')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', task.id)
    .eq('status', 'queued')
    .select('id, title, instructions, context, status')
    .maybeSingle();
  if (claimErr) return Response.json({ error: 'claim_failed' }, { status: 500 });
  if (!claimed) {
    return Response.json({ error: 'conflict', message: 'Task was already claimed or is no longer queued.' }, { status: 409 });
  }

  await logEvent(auth, task.id, 'claimed', { title: task.title });
  return Response.json({ task: claimed });
}
