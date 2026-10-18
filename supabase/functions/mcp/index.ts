// Agent Relay MCP endpoint.
// Agents authenticate with a scoped connection token (Authorization: Bearer <token>).
// Tokens are stored as SHA-256 hashes; plaintext is never persisted.
// Uses the service role key at runtime, so ALL permission checks are done here:
// the token's workspace defines the only data it can ever see or touch.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// MCP protocol version this endpoint implements.
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'agent-relay', version: '1.2.0' };

// 100 requests per token per 60 seconds, enforced durably in the database.
const RATE_LIMIT = { max: 100, windowSeconds: 60 };

// Serialized jsonb payload cap (matches the DB trigger in tasks_json_bounds).
const MAX_JSON_BYTES = 32768;

type Json = Record<string, unknown>;

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function rpcResult(id: unknown, result: Json): Response {
  return json({ jsonrpc: '2.0', id, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return json({ jsonrpc: '2.0', id, error: { code, message } });
}

function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return Infinity;
  }
}

function sha256Hex(value: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(value))
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!rawToken) return json({ error: 'missing_token' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const tokenHash = await sha256Hex(rawToken);
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('agent_tokens')
      .select('id, agent_id, workspace_id, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (tokenErr || !tokenRow) return json({ error: 'invalid_token' }, 401);
    if (tokenRow.revoked_at) return json({ error: 'token_revoked' }, 401);

    // Durable rate limiting: atomically increment a per-minute window row.
    const windowStart = new Date(Math.floor(Date.now() / (RATE_LIMIT.windowSeconds * 1000)) * RATE_LIMIT.windowSeconds * 1000).toISOString();
    const { data: count, error: rlErr } = await supabase.rpc('bump_rate_limit', {
      p_token_id: tokenRow.id,
      p_window_start: windowStart,
      p_max: RATE_LIMIT.max,
    });
    if (rlErr || typeof count !== 'number') return json({ error: 'rate_limiter_unavailable' }, 503);
    if (count > RATE_LIMIT.max) {
      return json({ error: 'rate_limited', limit: RATE_LIMIT.max, window_seconds: RATE_LIMIT.windowSeconds }, 429);
    }

    // Touch last_used_at (best-effort, not a failure if it fails).
    await supabase
      .from('agent_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tokenRow.id);

    const workspaceId: string = tokenRow.workspace_id;
    const agentId: string = tokenRow.agent_id;

    const body = await req.json().catch(() => null) as (Json & { method?: string; id?: unknown; params?: Json }) | null;
    if (!body || typeof body.method !== 'string') return json({ error: 'invalid_request' }, 400);

    const { method, id = null, params = {} } = body;

    // Notifications (no id) never get a response per the JSON-RPC 2.0 spec —
    // answering them confuses strict MCP clients that treat any reply as an
    // error against an outstanding request.
    const isNotification = body.id === undefined || body.id === null;
    if (isNotification) {
      if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        return new Response(null, { status: 202, headers: corsHeaders });
      }
      return new Response(null, { status: 202, headers: corsHeaders });
    }

    // ---- MCP lifecycle -------------------------------------------------------
    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    if (method === 'ping') {
      return rpcResult(id, {});
    }

    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: [
          {
            name: 'get_started',
            description: 'START HERE. Returns your identity, workspace, the full list of tools you can call and the recommended workflow for delegating and completing tasks. Call this once when you connect.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'send_task',
            description: 'Delegate a task to another agent in the same workspace. Returns the task ID and status. If the task is marked as requiring approval, it will not run until the workspace owner approves it.',
            inputSchema: {
              type: 'object',
              properties: {
                recipient_agent_name: { type: 'string', description: 'Name of the agent to send the task to' },
                title: { type: 'string', description: 'Short task title' },
                instructions: { type: 'string', description: 'What the receiving agent should do' },
                context: { type: 'object', description: 'Optional structured context payload' },
                requires_approval: { type: 'boolean', description: 'Whether the workspace owner must approve before the task runs' },
                timeout_minutes: { type: 'number', description: 'Timeout in minutes (default 60, max 1440)' },
              },
              required: ['recipient_agent_name', 'title', 'instructions'],
            },
          },
          {
            name: 'claim_task',
            description: 'Claim the next queued task assigned to you (or list available ones without claiming). Claiming moves the task to running.',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: { type: 'string', description: 'Claim a specific task instead of the next queued one' },
                peek: { type: 'boolean', description: 'If true, list the next queued tasks without claiming' },
              },
            },
          },
          {
            name: 'update_task',
            description: 'Report progress on a task you claimed: mark it running, completed (with a result), or failed (with an error). Only the assigned agent can update a task.',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: { type: 'string' },
                status: { type: 'string', enum: ['running', 'completed', 'failed'] },
                result: { type: 'object', description: 'Structured result payload (required when status is completed)' },
                error: { type: 'string', description: 'Error message (required when status is failed)' },
              },
              required: ['task_id', 'status'],
            },
          },
          {
            name: 'check_task',
            description: 'Check the status, result and error of a task in your workspace.',
            inputSchema: {
              type: 'object',
              properties: { task_id: { type: 'string', description: 'The task ID returned by send_task' } },
              required: ['task_id'],
            },
          },
          {
            name: 'get_result',
            description: 'Fetch the result payload of a completed task.',
            inputSchema: {
              type: 'object',
              properties: { task_id: { type: 'string', description: 'The task ID returned by send_task' } },
              required: ['task_id'],
            },
          },
          {
            name: 'list_agents',
            description: 'List the agents connected in your workspace.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'cancel_task',
            description: 'Cancel a task. You can cancel tasks you sent; the workspace owner can cancel any task from the dashboard.',
            inputSchema: {
              type: 'object',
              properties: { task_id: { type: 'string', description: 'The task ID returned by send_task' } },
              required: ['task_id'],
            },
          },
        ],
      });
    }

    if (method === 'tools/call') {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const args = (params.arguments ?? {}) as Json;

      // Load the calling agent's name so we can resolve recipient names.
      const { data: caller } = await supabase
        .from('agents')
        .select('id, name')
        .eq('id', agentId)
        .maybeSingle();
      if (!caller) return rpcError(id, -32603, 'calling agent not found');

      const logEvent = (taskId: string | null, eventType: string, detail: Json) =>
        supabase.from('task_events').insert({
          task_id: taskId,
          workspace_id: workspaceId,
          event_type: eventType,
          actor: `agent:${caller.name}`,
          detail,
        });

      switch (toolName) {
        case 'get_started': {
          const { data: ws } = await supabase
            .from('workspaces')
            .select('name, created_at')
            .eq('id', workspaceId)
            .maybeSingle();

          const guide = [
            '# Agent Relay — your capabilities',
            '',
            `You are the agent "${caller.name}".`,
            `You operate inside the workspace "${ws?.name ?? workspaceId}" and can ONLY see and act on data in this workspace.`,
            'You authenticate with a scoped connection token (an API key). If it is revoked, all your calls will be rejected.',
            '',
            '## What you can do',
            '- Delegate tasks to other agents in the workspace (send_task).',
            '- Pick up tasks assigned to you and work on them (claim_task).',
            '- Report progress, results or failures back (update_task).',
            '- Track any task in the workspace (check_task, get_result).',
            '- See who else is connected (list_agents).',
            '- Cancel tasks you sent (cancel_task).',
            '',
            '## Recommended workflow',
            '1. Call list_agents to see the other agents you can collaborate with.',
            '2. To delegate: call send_task with recipient_agent_name (exact name from list_agents), title and instructions. You receive a task_id — keep it for follow-ups.',
            '3. To receive work: poll claim_task. It returns the oldest queued task assigned to you (or a specific one via task_id) and moves it to running. If it returns task: null, you have nothing queued right now.',
            '4. After finishing work: call update_task with status "completed" and a structured result object, or status "failed" and an error message. Only you can update tasks assigned to you.',
            '5. To check on a task you sent: call check_task (status, result, error) or get_result (only after completion).',
            '',
            '## Rules that apply to you',
            '- If a task you send is flagged requires_approval, it stays in awaiting_approval until the human workspace owner approves it from the dashboard. It cannot be claimed before that.',
            '- Tasks have timeouts (default 60 minutes, configurable per task). Running tasks that exceed their timeout are automatically marked failed.',
            '- Completed, failed and cancelled tasks cannot change state again.',
            '- Rate limit: 100 requests per minute for your token. Exceeding it returns a 429 response — wait and retry.',
            '',
            '## Task statuses you will see',
            'awaiting_approval -> queued -> running -> completed | failed, with cancelled possible from any active state.',
          ].join('\n');

          return rpcResult(id, { content: [{ type: 'text', text: guide }] });
        }

        case 'list_agents': {
          const { data, error } = await supabase
            .from('agents')
            .select('id, name, description, created_at')
            .eq('workspace_id', workspaceId);
          if (error) return rpcError(id, -32603, error.message);
          return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ agents: data }) }] });
        }

        case 'send_task': {
          const recipientName = String(args.recipient_agent_name ?? '').trim();
          const title = String(args.title ?? '').trim();
          const instructions = String(args.instructions ?? '').trim();
          if (!recipientName) return rpcError(id, -32602, 'recipient_agent_name is required');
          if (!title || !instructions) return rpcError(id, -32602, 'title and instructions are required');
          if (title.length > 200) return rpcError(id, -32602, 'title must be at most 200 characters');
          if (instructions.length > 10000) return rpcError(id, -32602, 'instructions must be at most 10000 characters');

          const { data: recipient, error: recErr } = await supabase
            .from('agents')
            .select('id, name')
            .eq('workspace_id', workspaceId)
            .eq('name', recipientName)
            .maybeSingle();
          if (recErr) return rpcError(id, -32603, recErr.message);
          if (!recipient) {
            return rpcError(id, -32602, `agent "${recipientName}" not found in this workspace`);
          }
          if (recipient.id === agentId) {
            return rpcError(id, -32602, 'cannot send a task to yourself');
          }

          const timeoutMinutes = Math.min(Math.max(Number(args.timeout_minutes ?? 60) || 60, 1), 1440);
          const requiresApproval = args.requires_approval === true;

          if (args.context !== undefined && jsonByteSize(args.context) > MAX_JSON_BYTES) {
            return rpcError(id, -32602, `context payload too large (max ${MAX_JSON_BYTES} bytes serialized)`);
          }

          // Idempotency: a deterministic key derived from the request content so a
          // retried send after a network error returns the original task instead of
          // creating a duplicate. Clients can pass their own key to force distinct
          // tasks with identical content.
          const clientKey = typeof args.idempotency_key === 'string' && args.idempotency_key.trim()
            ? args.idempotency_key.trim().slice(0, 128)
            : null;
          const idempotencyKey = clientKey ??
            `auto:${agentId}:${recipient.id}:${title}:${instructions}:${requiresApproval ? 1 : 0}`;

          const { data: task, error: taskErr } = await supabase
            .from('tasks')
            .insert({
              workspace_id: workspaceId,
              sender_agent_id: agentId,
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
            // Unique-index hit: an identical task already exists (retried send).
            // Return the existing task so the retry is idempotent.
            const isDup = taskErr.code === '23505' || /duplicate key|unique constraint/i.test(taskErr.message);
            if (isDup) {
              const { data: existing } = await supabase
                .from('tasks')
                .select('id, status, created_at')
                .eq('workspace_id', workspaceId)
                .eq('sender_agent_id', agentId)
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle();
              if (existing) {
                return rpcResult(id, {
                  content: [{ type: 'text', text: JSON.stringify({ task_id: existing.id, status: existing.status, deduplicated: true }) }],
                });
              }
            }
            return rpcError(id, -32603, taskErr.message ?? 'task insert failed');
          }
          if (!task) return rpcError(id, -32603, 'task insert failed');

          await logEvent(task.id, requiresApproval ? 'created_awaiting_approval' : 'created', {
            title,
            recipient: recipientName,
            requires_approval: requiresApproval,
          });

          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ task_id: task.id, status: task.status }) }],
          });
        }

        case 'claim_task': {
          const peek = args.peek === true;
          const specificId = typeof args.task_id === 'string' ? args.task_id : '';

          // Fail tasks whose running window exceeded their timeout. Queued tasks
          // past their timeout are also expired so stale work never surfaces.
          await supabase.rpc('expire_stale_tasks', { p_workspace_id: workspaceId });

          if (specificId) {
            const { data: task, error } = await supabase
              .from('tasks')
              .select('id, title, instructions, context, status, created_at')
              .eq('id', specificId)
              .eq('workspace_id', workspaceId)
              .eq('recipient_agent_id', agentId)
              .maybeSingle();
            if (error) return rpcError(id, -32603, error.message);
            if (!task) return rpcError(id, -32602, 'task not found or not assigned to you');
            if (task.status !== 'queued') {
              return rpcError(id, -32602, `task is not claimable (status: ${task.status})`);
            }
            if (peek) {
              return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ tasks: [task] }) }] });
            }
            const { data: claimed, error: claimErr } = await supabase
              .from('tasks')
              .update({ status: 'running', updated_at: new Date().toISOString() })
              .eq('id', task.id)
              .eq('status', 'queued')
              .select('id, title, instructions, context, status, created_at')
              .maybeSingle();
            if (claimErr) return rpcError(id, -32603, claimErr.message);
            if (!claimed) return rpcError(id, -32602, 'task was already claimed or is no longer queued');
            await logEvent(task.id, 'claimed', { title: task.title });
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ task: claimed }) }] });
          }

          // Next queued task for this agent (or owner-sent tasks).
          const { data: queued, error: qErr } = await supabase
            .from('tasks')
            .select('id, title, instructions, context, status, created_at')
            .eq('workspace_id', workspaceId)
            .eq('recipient_agent_id', agentId)
            .eq('status', 'queued')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (qErr) return rpcError(id, -32603, qErr.message);
          if (!queued) {
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ task: null }) }] });
          }
          if (peek) {
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ tasks: [queued] }) }] });
          }
          const { data: claimed, error: claimErr } = await supabase
            .from('tasks')
            .update({ status: 'running', updated_at: new Date().toISOString() })
            .eq('id', queued.id)
            .eq('status', 'queued')
            .select('id, title, instructions, context, status, created_at')
            .maybeSingle();
          if (claimErr) return rpcError(id, -32603, claimErr.message);
          if (!claimed) return rpcError(id, -32602, 'task was already claimed or is no longer queued');
          await logEvent(queued.id, 'claimed', { title: queued.title });
          return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ task: claimed }) }] });
        }

        case 'update_task': {
          const taskId = String(args.task_id ?? '');
          const newStatus = String(args.status ?? '');
          if (!['running', 'completed', 'failed'].includes(newStatus)) {
            return rpcError(id, -32602, 'status must be running, completed or failed');
          }

          const { data: task, error: tErr } = await supabase
            .from('tasks')
            .select('id, status, recipient_agent_id, title')
            .eq('id', taskId)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
          if (tErr) return rpcError(id, -32603, tErr.message);
          if (!task) return rpcError(id, -32602, 'task not found in this workspace');
          if (task.recipient_agent_id !== agentId) {
            return rpcError(id, -32603, 'only the assigned agent can update this task');
          }

          const now = new Date().toISOString();
          const patch: Json = { status: newStatus, updated_at: now };
          if (newStatus === 'completed') {
            if (args.result === undefined || args.result === null || typeof args.result !== 'object') {
              return rpcError(id, -32602, 'a result object is required when marking a task completed');
            }
            patch.result = args.result;
            patch.completed_at = now;
          } else if (newStatus === 'failed') {
            const errText = String(args.error ?? '').trim();
            if (!errText) return rpcError(id, -32602, 'an error message is required when marking a task failed');
            patch.error = errText.slice(0, 5000);
            patch.completed_at = now;
          }

          // Valid transitions: running -> running/completed/failed. A queued task
          // must be claimed through claim_task (atomic CAS + audit event); a silent
          // queued->running move here would bypass both.
          const allowedFrom = newStatus === 'running' ? ['running'] : ['running'];
          if (!allowedFrom.includes(task.status)) {
            return rpcError(id, -32602, `cannot move task from ${task.status} to ${newStatus} (claim it first via claim_task)`);
          }

          const { data: updated, error: upErr } = await supabase
            .from('tasks')
            .update(patch)
            .eq('id', task.id)
            .in('status', allowedFrom)
            .select('id, status, result, error, completed_at')
            .maybeSingle();
          if (upErr) return rpcError(id, -32603, upErr.message);
          if (!updated) return rpcError(id, -32602, 'task state changed concurrently; check and retry');

          await logEvent(
            task.id,
            newStatus === 'completed' ? 'completed' : newStatus === 'failed' ? 'failed' : 'started',
            { title: task.title },
          );
          return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(updated) }] });
        }

        case 'check_task': {
          const taskId = String(args.task_id ?? '');
          await supabase.rpc('expire_stale_tasks', { p_workspace_id: workspaceId });
          const { data: task, error } = await supabase
            .from('tasks')
            .select('id, title, status, error, result, created_at, updated_at, completed_at, approved_at')
            .eq('id', taskId)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
          if (error) return rpcError(id, -32603, error.message);
          if (!task) return rpcError(id, -32602, 'task not found in this workspace');
          return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(task) }] });
        }

        case 'get_result': {
          const taskId = String(args.task_id ?? '');
          const { data: task, error } = await supabase
            .from('tasks')
            .select('status, result, error, completed_at')
            .eq('id', taskId)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
          if (error) return rpcError(id, -32603, error.message);
          if (!task) return rpcError(id, -2, 'task not found in this workspace');
          if (task.status !== 'completed') {
            return rpcError(id, -32002, `task is not completed (status: ${task.status})`);
          }
          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ task_id: taskId, result: task.result, completed_at: task.completed_at }) }],
          });
        }

        case 'cancel_task': {
          const taskId = String(args.task_id ?? '');
          const { data: task, error: tErr } = await supabase
            .from('tasks')
            .select('id, status, sender_agent_id, title')
            .eq('id', taskId)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
          if (tErr) return rpcError(id, -32603, tErr.message);
          if (!task) return rpcError(id, -32602, 'task not found in this workspace');
          if (task.sender_agent_id !== agentId) {
            return rpcError(id, -32603, 'only the agent that sent a task can cancel it');
          }
          const cancellable = ['awaiting_approval', 'queued', 'running'];
          if (!cancellable.includes(task.status)) {
            return rpcError(id, -32602, `task in status ${task.status} cannot be cancelled`);
          }
          const { error: upErr } = await supabase
            .from('tasks')
            .update({ status: 'cancelled', updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
            .eq('id', task.id)
            .in('status', cancellable);
          if (upErr) return rpcError(id, -32603, upErr.message);
          await logEvent(task.id, 'cancelled', { by: 'sender agent' });
          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ task_id: task.id, status: 'cancelled' }) }],
          });
        }

        default:
          return rpcError(id, -32602, `unknown tool: ${toolName}`);
      }
    }

    return rpcError(id, -32601, `unknown method: ${method}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error';
    return json({ error: 'internal_error', message }, 500);
  }
});
