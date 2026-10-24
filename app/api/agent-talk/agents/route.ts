import { authenticateAgent, enforceRateLimit, touchToken, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// GET /api/agent-talk/agents
// List all agents in the caller's workspace (excluding the caller itself).
// Response: { agents: [{ id, name, description, created_at }] }
export async function GET(req: Request) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);
  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);

  const { data: agents, error } = await auth.supabase
    .from('agents')
    .select('id, name, description, created_at')
    .eq('workspace_id', auth.workspaceId)
    .neq('id', auth.agentId)
    .order('name');
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  return Response.json({ agents });
}
