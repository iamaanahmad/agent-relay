import { authenticateAgent, enforceRateLimit, touchToken, expireStaleTasks, logEvent, readJson, jsonError, jsonByteSize, limits } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// Submit the result ("reply") as the assigned recipient. Mirrors the MCP
// update_task semantics: claim first (queued -> running happens through the
// claim flow), then completed with a result or failed with an error.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);

  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);

  const parsed = await readJson(req);
  if (!parsed.ok) {
    return Response.json({ error: 'invalid_body', message: 'Send a JSON object body.' }, { status: 400 });
  }
  await touchToken(auth);
  await expireStaleTasks(auth);

  const args = parsed.body;
  const taskId = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return Response.json({ error: 'invalid_task_id' }, { status: 400 });
  }

  const status = typeof args.status === 'string' ? args.status : '';
  if (!['completed', 'failed'].includes(status)) {
    return Response.json({ error: 'status must be "completed" or "failed"' }, { status: 400 });
  }

  const { data: task, error: tErr } = await auth.supabase
    .from('tasks')
    .select('id, status, recipient_agent_id, sender_agent_id, title')
    .eq('id', taskId)
    .eq('workspace_id', auth.workspaceId)
    .maybeSingle();
  if (tErr) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!task) return Response.json({ error: 'task_not_found' }, { status: 404 });
  if (task.recipient_agent_id !== auth.agentId) {
    return Response.json({ error: 'forbidden', message: 'Only the assigned recipient can reply to this task.' }, { status: 403 });
  }
  if (task.status !== 'running') {
    return Response.json({
      error: 'not_claimable',
      message: `Task is ${task.status}. The recipient must claim it (POST /api/agent-talk/turns/${taskId}/claim) before replying.`,
    }, { status: 409 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === 'completed') {
    if (!args.result || typeof args.result !== 'object' || Array.isArray(args.result)) {
      return Response.json({ error: 'a result object is required when marking a task completed' }, { status: 400 });
    }
    if (jsonByteSize(args.result) > limits.MAX_JSON_BYTES) {
      return Response.json({ error: `result payload too large (max ${limits.MAX_JSON_BYTES} bytes serialized)` }, { status: 413 });
    }
    patch.result = args.result;
    patch.completed_at = now;
  } else {
    const errText = typeof args.error === 'string' ? args.error.trim() : '';
    if (!errText) return Response.json({ error: 'an error message is required when marking a task failed' }, { status: 400 });
    patch.error = errText.slice(0, 5000);
    patch.completed_at = now;
  }

  const { data: updated, error: upErr } = await auth.supabase
    .from('tasks')
    .update(patch)
    .eq('id', task.id)
    .eq('status', 'running')
    .select('id, status')
    .maybeSingle();
  if (upErr) return Response.json({ error: 'update_failed' }, { status: 500 });
  if (!updated) {
    return Response.json({ error: 'conflict', message: 'Task state changed concurrently; check its status and retry.' }, { status: 409 });
  }

  await logEvent(auth, task.id, status === 'completed' ? 'completed' : 'failed', { title: task.title });

  return Response.json({ task_id: task.id, status: updated.status });
}
