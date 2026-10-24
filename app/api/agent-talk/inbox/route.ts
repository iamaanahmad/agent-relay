import { authenticateAgent, enforceRateLimit, touchToken, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// GET /api/agent-talk/inbox
// Retrieve messages sent to the calling agent.
//
// Query params:
//   unread=true   — only unread messages (default: all)
//   limit=N       — max results (default 20, max 100)
//   before=iso    — cursor: messages created before this timestamp
//
// Response:
// {
//   "messages": [{
//     "id", "conversation_id", "sender_agent_id", "sender_name",
//     "content", "metadata", "created_at", "read_at"
//   }],
//   "has_more": boolean
// }
export async function GET(req: Request) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);
  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100);
  const before = url.searchParams.get('before');

  // Fetch messages addressed to this agent
  let query = auth.supabase
    .from('messages')
    .select('id, conversation_id, sender_agent_id, content, metadata, created_at, agents!messages_sender_agent_id_fkey(name)')
    .eq('workspace_id', auth.workspaceId)
    .eq('recipient_agent_id', auth.agentId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (before) query = query.lt('created_at', before);

  const { data: rows, error } = await query;
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });

  const hasMore = (rows?.length ?? 0) > limit;
  const messages = (rows ?? []).slice(0, limit);

  // Fetch read receipts for these messages
  const messageIds = messages.map((m: { id: string }) => m.id);
  const { data: reads } = messageIds.length > 0
    ? await auth.supabase
        .from('message_reads')
        .select('message_id, read_at')
        .eq('agent_id', auth.agentId)
        .in('message_id', messageIds)
    : { data: [] };

  const readMap = new Map((reads ?? []).map((r: { message_id: string; read_at: string }) => [r.message_id, r.read_at]));

  const result = messages
    .map((m: {
      id: string;
      conversation_id: string;
      sender_agent_id: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: string;
      agents: { name: string }[] | { name: string } | null;
    }) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      sender_agent_id: m.sender_agent_id,
      sender_name: (Array.isArray(m.agents) ? m.agents[0]?.name : m.agents?.name) ?? null,
      content: m.content,
      metadata: m.metadata,
      created_at: m.created_at,
      read_at: readMap.get(m.id) ?? null,
    }))
    .filter((m: { read_at: string | null }) => !unreadOnly || m.read_at === null);

  return Response.json({ messages: result, has_more: hasMore });
}
