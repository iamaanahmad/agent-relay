import { authenticateAgent, enforceRateLimit, touchToken, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// GET /api/agent-talk/conversations/{id}
// Retrieve message history for a conversation the caller participates in.
//
// Query params:
//   limit=N       — max results (default 50, max 100)
//   before=iso    — cursor: messages created before this timestamp
//
// Response:
// {
//   "conversation_id": "uuid",
//   "participants": [{ "agent_id", "name" }],
//   "messages": [{ "id", "sender_agent_id", "sender_name", "recipient_agent_id",
//                  "content", "metadata", "created_at", "read_at" }],
//   "has_more": boolean
// }
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);
  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);

  const conversationId = params.id;
  if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return Response.json({ error: 'invalid_conversation_id' }, { status: 400 });
  }

  // Verify caller is a participant
  const { data: membership } = await auth.supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('agent_id', auth.agentId)
    .maybeSingle();
  if (!membership) return Response.json({ error: 'conversation_not_found', message: 'Conversation not found or you are not a participant.' }, { status: 404 });

  // Verify conversation belongs to this workspace
  const { data: conv } = await auth.supabase
    .from('conversations')
    .select('id, workspace_id, created_at')
    .eq('id', conversationId)
    .eq('workspace_id', auth.workspaceId)
    .maybeSingle();
  if (!conv) return Response.json({ error: 'conversation_not_found' }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const before = url.searchParams.get('before');

  // Fetch participants with names
  const { data: participants } = await auth.supabase
    .from('conversation_participants')
    .select('agent_id, agents(name)')
    .eq('conversation_id', conversationId);

  // Fetch messages
  let msgQuery = auth.supabase
    .from('messages')
    .select('id, sender_agent_id, recipient_agent_id, content, metadata, created_at, agents!messages_sender_agent_id_fkey(name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (before) msgQuery = msgQuery.lt('created_at', before);

  const { data: rows, error } = await msgQuery;
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });

  const hasMore = (rows?.length ?? 0) > limit;
  const messages = (rows ?? []).slice(0, limit);

  // Fetch read receipts for this agent
  const messageIds = messages.map((m: { id: string }) => m.id);
  const { data: reads } = messageIds.length > 0
    ? await auth.supabase
        .from('message_reads')
        .select('message_id, read_at')
        .eq('agent_id', auth.agentId)
        .in('message_id', messageIds)
    : { data: [] };

  const readMap = new Map((reads ?? []).map((r: { message_id: string; read_at: string }) => [r.message_id, r.read_at]));

  return Response.json({
    conversation_id: conversationId,
    created_at: conv.created_at,
    participants: (participants ?? []).map((p: { agent_id: string; agents: { name: string }[] | { name: string } | null }) => ({
      agent_id: p.agent_id,
      name: (Array.isArray(p.agents) ? p.agents[0]?.name : p.agents?.name) ?? null,
    })),
    messages: messages.map((m: {
      id: string;
      sender_agent_id: string;
      recipient_agent_id: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: string;
      agents: { name: string }[] | { name: string } | null;
    }) => ({
      id: m.id,
      sender_agent_id: m.sender_agent_id,
      sender_name: (Array.isArray(m.agents) ? m.agents[0]?.name : m.agents?.name) ?? null,
      recipient_agent_id: m.recipient_agent_id,
      content: m.content,
      metadata: m.metadata,
      created_at: m.created_at,
      read_at: readMap.get(m.id) ?? null,
    })),
    has_more: hasMore,
  });
}
