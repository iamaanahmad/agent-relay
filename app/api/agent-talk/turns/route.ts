import { authenticateAgent, enforceRateLimit, touchToken, expireStaleTasks, logEvent, readJson, jsonError, jsonByteSize, limits, GuardFailure } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// Submit a task ("turn") to a specific recipient agent.
// Immediate acknowledgment with the task ID and status; the actual work happens
// asynchronously — the recipient claims, then replies. Queueing is NOT proof of
// execution; the response status only ever says awaiting_approval or queued.
export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);

  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);

  const parsed = await readJson(req);
  if (!parsed.ok) {
    return Response.json({ error: 'invalid_body', message: 'Send a JSON object body.' }, { status: 400 });
  }
  const args = parsed.body;
  await touchToken(auth);

  const recipientName = typeof args.recipient_agent_name === 'string' ? args.recipient_agent_name.trim() : '';
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : '';
  if (!recipientName) {
    return Response.json({ error: 'recipient_agent_name is required' }, { status: 400 });
  }
  if (!title || !instructions) {
    return Response.json({ error: 'title and instructions are required' }, { status: 400 });
  }
  if (title.length > limits.titleMax) {
    return Response.json({ error: `title must be at most ${limits.titleMax} characters` }, { status: 400 });
  }
  if (instructions.length > limits.instructionsMax) {
    return Response.json({ error: `instructions must be at most ${limits.instructionsMax} characters` }, { status: 400 });
  }
  if (args.context !== undefined && (typeof args.context !== 'object' || args.context === null || Array.isArray(args.context))) {
    return Response.json({ error: 'context must be an object' }, { status: 400 });
  }
  if (jsonByteSize(args.context) > limits.MAX_JSON_BYTES) {
    return Response.json({ error: `context payload too large (max ${limits.MAX_JSON_BYTES} bytes serialized)` }, { status: 413 });
  }

  const { data: recipient, error: recErr } = await auth.supabase
    .from('agents')
    .select('id, name')
    .eq('workspace_id', auth.workspaceId)
    .eq('name', recipientName)
    .maybeSingle();
  if (recErr) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!recipient) {
    return Response.json({ error: 'recipient_not_found', message: `No agent named "${recipientName}" exists in this workspace.` }, { status: 404 });
  }
  if (recipient.id === auth.agentId) {
    return Response.json({ error: 'cannot_send_to_self' }, { status: 400 });
  }

  const requiresApproval = args.requires_approval === true;
  const timeoutMinutes = Math.min(Math.max(Number(args.timeout_minutes ?? 60) || 60, 1), 1440);

  const clientKey = typeof args.idempotency_key === 'string' && args.idempotency_key.trim()
    ? args.idempotency_key.trim().slice(0, 128)
    : null;
  const idempotencyKey = clientKey ??
    `auto:${auth.agentId}:${recipient.id}:${title}:${instructions}:${requiresApproval ? 1 : 0}`;

  const { data: task, error: taskErr } = await auth.supabase
    .from('tasks')
    .insert({
      workspace_id: auth.workspaceId,
      sender_agent_id: auth.agentId,
      recipient_agent_id: recipient.id,
      title,
      instructions,
      context: (args.context && typeof args.context === 'object') ? args.context : {},
      status: requiresApproval ? 'awaiting_approval' : 'queued',
      requires_approval: requiresApproval,
      timeout_minutes: timeoutMinutes,
      idempotency_key: idempotencyKey,
    })
    .select('id, status, created_at')
    .maybeSingle();

  if (taskErr) {
    const isDup = taskErr.code === '23505' || /duplicate key|unique constraint/i.test(taskErr.message);
    if (isDup) {
      const { data: existing } = await auth.supabase
        .from('tasks')
        .select('id, status, created_at')
        .eq('workspace_id', auth.workspaceId)
        .eq('sender_agent_id', auth.agentId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing) {
        return Response.json({ task_id: existing.id, status: existing.status, created_at: existing.created_at, deduplicated: true });
      }
    }
    return Response.json({ error: 'submit_failed' }, { status: 500 });
  }
  if (!task) return Response.json({ error: 'submit_failed' }, { status: 500 });

  await logEvent(auth, task.id, requiresApproval ? 'created_awaiting_approval' : 'created', {
    title,
    recipient: recipientName,
    requires_approval: requiresApproval,
  });

  // Queueing is not execution: status here is the acceptance receipt only.
  return Response.json({
    task_id: task.id,
    status: task.status,
    created_at: task.created_at,
    note: 'Accepted. The recipient has not started it yet — poll GET to track progress.',
  }, { status: 201 });
}

// Convenience: list agents you can address (kept on the same resource for
// discoverability by coding agents).
export async function GET(req: Request) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);
  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);
  await expireStaleTasks(auth);

  const { data: agents, error } = await auth.supabase
    .from('agents')
    .select('id, name, description')
    .eq('workspace_id', auth.workspaceId)
    .neq('id', auth.agentId)
    .order('name');
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  return Response.json({ agents });
}
