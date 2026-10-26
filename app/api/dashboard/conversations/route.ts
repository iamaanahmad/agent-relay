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

// POST /api/dashboard/conversations
// Create a new group or DM conversation from the dashboard (human operator).
// Body: { title?, type: 'group'|'dm', participant_agent_ids: string[], workspace_id: string }
export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuth(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { title, type = 'group', participant_agent_ids, workspace_id } = body;
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!participant_agent_ids || !Array.isArray(participant_agent_ids) || participant_agent_ids.length === 0) {
    return NextResponse.json({ error: 'participant_agent_ids required' }, { status: 400 });
  }

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({
      workspace_id,
      type,
      title: title?.trim() || null,
      created_by_user_id: user.id,
      metadata: {},
    })
    .select('id, created_at')
    .maybeSingle();

  if (convErr || !conv) return NextResponse.json({ error: 'create_failed', detail: convErr?.message }, { status: 500 });

  const participants = (participant_agent_ids as string[]).map((agent_id) => ({
    conversation_id: conv.id,
    agent_id,
  }));
  const { error: partErr } = await supabase.from('conversation_participants').insert(participants);
  if (partErr) return NextResponse.json({ error: 'participants_failed', detail: partErr.message }, { status: 500 });

  return NextResponse.json({ conversation_id: conv.id, created_at: conv.created_at }, { status: 201 });
}
