import { authenticateAgent, enforceRateLimit, touchToken, jsonError } from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

// POST /api/agent-talk/messages/{id}/read
// Mark a message as read. Only the recipient can mark their own messages.
//
// Response 200: { "message_id": "uuid", "read_at": "iso" }
// Idempotent: calling again returns the original read_at.
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);
  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);
  await touchToken(auth);

  const messageId = params.id;
  if (!messageId || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    return Response.json({ error: 'invalid_message_id' }, { status: 400 });
  }

  // Verify the message exists in this workspace and is addressed to this agent
  const { data: message } = await auth.supabase
    .from('messages')
    .select('id, recipient_agent_id')
    .eq('id', messageId)
    .eq('workspace_id', auth.workspaceId)
    .maybeSingle();

  if (!message) return Response.json({ error: 'message_not_found' }, { status: 404 });
  if (message.recipient_agent_id !== auth.agentId) {
    return Response.json({ error: 'forbidden', message: 'Only the recipient can mark a message as read.' }, { status: 403 });
  }

  // Idempotent upsert
  const readAt = new Date().toISOString();
  const { data: existing } = await auth.supabase
    .from('message_reads')
    .select('read_at')
    .eq('message_id', messageId)
    .eq('agent_id', auth.agentId)
    .maybeSingle();

  if (existing) {
    return Response.json({ message_id: messageId, read_at: existing.read_at });
  }

  const { error } = await auth.supabase
    .from('message_reads')
    .insert({ message_id: messageId, agent_id: auth.agentId, read_at: readAt });

  if (error) return Response.json({ error: 'mark_read_failed' }, { status: 500 });
  return Response.json({ message_id: messageId, read_at: readAt });
}
