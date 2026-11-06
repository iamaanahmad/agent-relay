import { authenticateAgent, enforceRateLimit, touchToken, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// GET /api/agent-talk/inbox
// Retrieve messages sent to the calling agent (direct messages + group messages).
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
//     "content", "metadata", "created_at", "read_at", "conversation_type"
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

  // Get all conversations the agent participates in
  const { data: participations } = await auth.supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('agent_id', auth.agentId);

  const conversationIds = (participations ?? []).map((p: { conversation_id: string }) => p.conversation_id);
  if (conversationIds.length === 0) {
    return Response.json({ messages: [], has_more: false });
  }

  // Fetch messages:
  // 1. Direct messages where this agent is the recipient
  // 2. Group messages (recipient_agent_id IS NULL) in conversations they participate in
  // We use two separate queries because Supabase .or() doesn't interpolate template strings
  
  const baseSelect = 'id, conversation_id, sender_agent_id, content, metadata, created_at, recipient_agent_id, agents!messages_sender_agent_id_fkey(name), conversations!inner(type)';
  
  // Query 1: Direct messages to this agent
  let q1 = auth.supabase
    .from('messages')
    .select(baseSelect)
    .eq('workspace_id', auth.workspaceId)
    .in('conversation_id', conversationIds)
    .eq('recipient_agent_id', auth.agentId);

  // Query 2: Group messages (no specific recipient)
  let q2 = auth.supabase
    .from('messages')
    .select(baseSelect)
    .eq('workspace_id', auth.workspaceId)
    .in('conversation_id', conversationIds)
    .is('recipient_agent_id', null);

  if (before) {
    q1 = q1.lt('created_at', before);
    q2 = q2.lt('created_at', before);
  }

  const [{ data: directMessages, error: error1 }, { data: groupMessages, error: error2 }] = await Promise.all([q1, q2]);
  
  if (error1 || error2) return Response.json({ error: 'lookup_failed' }, { status: 500 });

  // Merge and sort both result sets
  const rows = [...(directMessages ?? []), ...(groupMessages ?? [])].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ).slice(0, limit + 1);

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
      recipient_agent_id: string | null;
      content: string;
      metadata: Record<string, unknown>;
      created_at: string;
      agents: { name: string }[] | { name: string } | null;
      conversations: { type: string }[] | { type: string } | null;
    }) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      sender_agent_id: m.sender_agent_id,
      sender_name: (Array.isArray(m.agents) ? m.agents[0]?.name : m.agents?.name) ?? null,
      recipient_agent_id: m.recipient_agent_id,
      content: m.content,
      metadata: m.metadata,
      created_at: m.created_at,
      read_at: readMap.get(m.id) ?? null,
      conversation_type: (Array.isArray(m.conversations) ? m.conversations[0]?.type : m.conversations?.type) ?? 'dm',
    }))
    .filter((m: { read_at: string | null }) => !unreadOnly || m.read_at === null);

  return Response.json({ messages: result, has_more: hasMore });
}
