import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Shared authentication + guard helpers for the Agent Talk REST API.
// Agents authenticate with the same scoped connection tokens as the MCP
// endpoint; the token's workspace defines the only data it can touch.
// All checks happen here against the service role — the anon key never
// reaches these routes with database privileges.

const RATE_LIMIT = { max: 100, windowSeconds: 60 };
const MAX_JSON_BYTES = 32768;
const MAX_BODY_BYTES = 128 * 1024;

export type AgentAuth = {
  supabase: SupabaseClient;
  tokenId: string;
  agentId: string;
  workspaceId: string;
  agentName: string;
};

export type GuardFailure = { status: number; body: Record<string, unknown> };

function fail(status: number, error: string, extra: Record<string, unknown> = {}): GuardFailure {
  return { status, body: { error, ...extra } };
}

export function jsonError(f: GuardFailure) {
  return Response.json(f.body, { status: f.status });
}

export function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return Infinity;
  }
}

export async function readJson(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

export async function authenticateAgent(req: Request): Promise<AgentAuth | GuardFailure> {
  const rawToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!rawToken) return fail(401, 'missing_token', { message: 'Send "Authorization: Bearer <your agent token>".' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const { data: tokenRow, error } = await supabase
    .from('agent_tokens')
    .select('id, agent_id, workspace_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !tokenRow) return fail(401, 'invalid_token', { message: 'This token was not recognized. Generate a new one from the agent page.' });
  if (tokenRow.revoked_at) return fail(401, 'token_revoked', { message: 'This token has been revoked. Generate a new one from the agent page.' });

  const { data: agent, error: agentErr } = await supabase
    .from('agents')
    .select('name')
    .eq('id', tokenRow.agent_id)
    .maybeSingle();
  if (agentErr || !agent) return fail(401, 'invalid_token', { message: 'The agent for this token no longer exists.' });

  return { supabase, tokenId: tokenRow.id, agentId: tokenRow.agent_id, workspaceId: tokenRow.workspace_id, agentName: agent.name };
}

export async function enforceRateLimit(auth: AgentAuth): Promise<GuardFailure | null> {
  const windowStart = new Date(
    Math.floor(Date.now() / (RATE_LIMIT.windowSeconds * 1000)) * RATE_LIMIT.windowSeconds * 1000,
  ).toISOString();
  const { data: count, error } = await auth.supabase.rpc('bump_rate_limit', {
    p_token_id: auth.tokenId,
    p_window_start: windowStart,
    p_max: RATE_LIMIT.max,
  });
  if (error || typeof count !== 'number') return fail(503, 'rate_limiter_unavailable', { message: 'Try again shortly.' });
  if (count > RATE_LIMIT.max) {
    return fail(429, 'rate_limited', { message: `Limit of ${RATE_LIMIT.max} requests per minute reached. Wait and retry.`, limit: RATE_LIMIT.max });
  }
  return null;
}

export async function touchToken(auth: AgentAuth): Promise<void> {
  await auth.supabase.from('agent_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', auth.tokenId);
}

// Fail tasks whose running window exceeded their timeout so callers never see
// stale state — same semantics as the MCP tools.
export async function expireStaleTasks(auth: AgentAuth): Promise<void> {
  await auth.supabase.rpc('expire_stale_tasks', { p_workspace_id: auth.workspaceId });
}

export function logEvent(auth: AgentAuth, taskId: string | null, eventType: string, detail: Record<string, unknown>) {
  return auth.supabase.from('task_events').insert({
    task_id: taskId,
    workspace_id: auth.workspaceId,
    event_type: eventType,
    actor: `agent:${auth.agentName}`,
    detail,
  });
}

export const limits = { MAX_JSON_BYTES, MAX_BODY_BYTES, titleMax: 200, instructionsMax: 10000 };
