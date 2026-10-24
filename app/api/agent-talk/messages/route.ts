import {
  authenticateAgent,
  enforceRateLimit,
  touchToken,
  readJson,
  jsonError,
  jsonByteSize,
} from '@/lib/agent-talk';

export const dynamic = 'force-dynamic';

const MAX_CONTENT_BYTES = 32768;
const MAX_METADATA_BYTES = 8192;

// POST /api/agent-talk/messages
// Send a message to a recipient agent. Creates or reuses a 1-to-1 conversation.
//
// Request body:
// {
//   "recipient_agent_name": "worker-1",   // required
//   "content": "Hello, can you help?",    // required, ≤ 32 KB
//   "conversation_id": "uuid",            // optional — reuse an existing thread
//   "metadata": {}                        // optional, ≤ 8 KB
// }
//
// Response 201:
// {
//   "message_id": "uuid",
//   "conversation_id": "uuid",
//   "status": "stored",
//   "created_at": "iso",
//   "note": "Message stored. The recipient has not read it yet."
// }
export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if ('status' in auth) return jsonError(auth);
  const rl = await enforceRateLimit(auth);
  if (rl) return jsonError(rl);

  const parsed = await readJson(req);
  if (!parsed.ok) return Response.json({ error: 'invalid_body', message: 'Send a JSON object body.' }, { status: 400 });
  const args = parsed.body;
  await touchToken(auth);

  const recipientName = typeof args.recipient_agent_name === 'string' ? args.recipient_agent_name.trim() : '';
  const content = typeof args.content === 'string' ? args.content : '';
  if (!recipientName) return Response.json({ error: 'recipient_agent_name is required' }, { status: 400 });
  if (!content.trim()) return Response.json({ error: 'content is required' }, { status: 400 });
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return Response.json({ error: `content too large (max ${MAX_CONTENT_BYTES} bytes)` }, { status: 413 });
  }
  if (args.metadata !== undefined && jsonByteSize(args.metadata) > MAX_METADATA_BYTES) {
    return Response.json({ error: `metadata too large (max ${MAX_METADATA_BYTES} bytes)` }, { status: 413 });
  }

  // Resolve recipient
  const { data: recipient, error: recErr } = await auth.supabase
    .from('agents')
    .select('id, name')
    .eq('workspace_id', auth.workspaceId)
    .eq('name', recipientName)
    .maybeSingle();
  if (recErr) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!recipient) return Response.json({ error: 'recipient_not_found', message: `No agent named "${recipientName}" in this workspace.` }, { status: 404 });
  if (recipient.id === auth.agentId) return Response.json({ error: 'cannot_message_self' }, { status: 400 });

  // Find or create a 1-to-1 conversation between these two agents
  let conversationId = typeof args.conversation_id === 'string' ? args.conversation_id.trim() : null;

  if (conversationId) {
    // Verify the caller is a participant in the supplied conversation
    const { data: membership } = await auth.supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('conversation_id', conversationId)
      .eq('agent_id', auth.agentId)
      .maybeSingle();
    if (!membership) return Response.json({ error: 'conversation_not_found', message: 'Conversation not found or you are not a participant.' }, { status: 404 });
  } else {
    // Find existing 1-to-1 conversation between these two agents in this workspace
    const { data: existing } = await auth.supabase
      .from('conversation_participants')
      .select('conversation_id, conversations!inner(workspace_id)')
      .eq('agent_id', auth.agentId)
      .eq('conversations.workspace_id', auth.workspaceId);

    if (existing && existing.length > 0) {
      const myConvIds = existing.map((r: { conversation_id: string }) => r.conversation_id);
      const { data: shared } = await auth.supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('agent_id', recipient.id)
        .in('conversation_id', myConvIds);
      if (shared && shared.length > 0) {
        conversationId = shared[0].conversation_id;
      }
    }

    if (!conversationId) {
      // Create new conversation
      const { data: conv, error: convErr } = await auth.supabase
        .from('conversations')
        .insert({ workspace_id: auth.workspaceId, metadata: {} })
        .select('id')
        .maybeSingle();
      if (convErr || !conv) return Response.json({ error: 'conversation_create_failed' }, { status: 500 });
      conversationId = conv.id;

      // Add both participants
      const { error: partErr } = await auth.supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: conversationId, agent_id: auth.agentId },
          { conversation_id: conversationId, agent_id: recipient.id },
        ]);
      if (partErr) return Response.json({ error: 'conversation_create_failed' }, { status: 500 });
    }
  }

  // Insert the message
  const { data: message, error: msgErr } = await auth.supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      workspace_id: auth.workspaceId,
      sender_agent_id: auth.agentId,
      recipient_agent_id: recipient.id,
      content,
      metadata: (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)) ? args.metadata : {},
    })
    .select('id, created_at')
    .maybeSingle();

  if (msgErr || !message) return Response.json({ error: 'send_failed' }, { status: 500 });

  return Response.json({
    message_id: message.id,
    conversation_id: conversationId,
    status: 'stored',
    created_at: message.created_at,
    note: 'Message stored. The recipient has not read it yet — stored status is not proof of delivery or execution.',
  }, { status: 201 });
}
