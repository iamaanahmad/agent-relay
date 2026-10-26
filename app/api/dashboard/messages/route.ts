import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function getAuth(req: NextRequest) {
  const { createServerClient } = await import('@supabase/ssr');
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// POST /api/dashboard/messages
// Send a message as the human operator into a conversation.
// Body: { conversation_id, content, workspace_id, recipient_agent_id? }
export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuth(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { conversation_id, content, workspace_id, recipient_agent_id } = body;
  if (!conversation_id) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, type')
    .eq('id', conversation_id)
    .eq('workspace_id', workspace_id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });

  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id,
      workspace_id,
      sender_user_id: user.id,
      sender_agent_id: null,
      recipient_agent_id: recipient_agent_id || null,
      content: (content as string).trim(),
      metadata: {},
    })
    .select('id, created_at')
    .maybeSingle();

  if (msgErr || !msg) return NextResponse.json({ error: 'send_failed', detail: msgErr?.message }, { status: 500 });

  return NextResponse.json({ message_id: msg.id, created_at: msg.created_at }, { status: 201 });
}
