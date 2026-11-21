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

// GET /api/dashboard/conversations
// List all conversations in a workspace with participant info and permissions.
// Query params: workspace_id (required)
export async function GET(req: NextRequest) {
  const { supabase, user } = await getAuth(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  const { data: convs, error } = await supabase
    .from('conversations')
    .select('id, type, title, created_at, can_agents_write, metadata')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'lookup_failed', detail: error.message }, { status: 500 });

  // Fetch participants for each conversation
  const convIds = (convs ?? []).map((c: { id: string }) => c.id);
  const { data: participants } = convIds.length > 0
    ? await supabase
        .from('conversation_participants')
        .select('conversation_id, agent_id, agents(name)')
        .in('conversation_id', convIds)
    : { data: [] };

  const participantMap = new Map<string, { agent_id: string; name: string | null }[]>();
  for (const p of (participants ?? [])) {
    const entry = participantMap.get(p.conversation_id) ?? [];
    const agentsData = p.agents as { name: string }[] | { name: string } | null;
    entry.push({
      agent_id: p.agent_id,
      name: (Array.isArray(agentsData) ? agentsData[0]?.name : agentsData?.name) ?? null,
    });
    participantMap.set(p.conversation_id, entry);
  }

  const result = (convs ?? []).map((c: {
    id: string;
    type: string;
    title: string | null;
    created_at: string;
    can_agents_write: boolean;
    metadata: Record<string, unknown>;
  }) => ({
    id: c.id,
    type: c.type,
    title: c.title,
    created_at: c.created_at,
    can_agents_write: c.can_agents_write,
    metadata: c.metadata,
    participants: participantMap.get(c.id) ?? [],
  }));

  return NextResponse.json({ conversations: result });
}

// POST /api/dashboard/conversations
// Create a new group or DM conversation from the dashboard (human operator).
// Body: { title?, type: 'group'|'dm', participant_agent_ids: string[], workspace_id: string, can_agents_write?: boolean }
export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuth(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { title, type = 'group', participant_agent_ids, workspace_id, can_agents_write = true } = body;
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!['group', 'dm'].includes(type)) {
    return NextResponse.json({ error: 'invalid_type', message: 'Conversation type must be group or dm.' }, { status: 400 });
  }
  if (typeof title === 'string' && title.length > 80) {
    return NextResponse.json({ error: 'title_too_long', message: 'Conversation titles may contain at most 80 characters.' }, { status: 400 });
  }
  if (typeof can_agents_write !== 'boolean') {
    return NextResponse.json({ error: 'invalid_permission', message: 'can_agents_write must be a boolean.' }, { status: 400 });
  }
  if (!participant_agent_ids || !Array.isArray(participant_agent_ids) || participant_agent_ids.length === 0) {
    return NextResponse.json({ error: 'participant_agent_ids required' }, { status: 400 });
  }
  if (participant_agent_ids.length > 50) {
    return NextResponse.json({ error: 'too_many_participants', message: 'A conversation supports at most 50 agents.' }, { status: 400 });
  }
  if (participant_agent_ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'invalid_participant', message: 'Participant agent IDs must be strings.' }, { status: 400 });
  }

  const uniqueAgentIds = Array.from(new Set(participant_agent_ids as string[]));
  const { data: validAgents, error: agentLookupError } = await supabase
    .from('agents')
    .select('id')
    .eq('workspace_id', workspace_id)
    .in('id', uniqueAgentIds);
  if (agentLookupError) {
    return NextResponse.json({ error: 'participant_lookup_failed' }, { status: 500 });
  }
  if (!validAgents || validAgents.length !== uniqueAgentIds.length) {
    return NextResponse.json({ error: 'invalid_participant', message: 'Every participant must belong to this workspace.' }, { status: 400 });
  }

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({
      workspace_id,
      type,
      title: title?.trim() || null,
      created_by_user_id: user.id,
      can_agents_write,
      metadata: {},
    })
    .select('id, created_at')
    .maybeSingle();

  if (convErr || !conv) return NextResponse.json({ error: 'create_failed', detail: convErr?.message }, { status: 500 });

  const participants = uniqueAgentIds.map((agent_id) => ({
    conversation_id: conv.id,
    agent_id,
  }));
  const { error: partErr } = await supabase.from('conversation_participants').insert(participants);
  if (partErr) return NextResponse.json({ error: 'participants_failed', detail: partErr.message }, { status: 500 });

  return NextResponse.json({ conversation_id: conv.id, created_at: conv.created_at }, { status: 201 });
}

// PATCH /api/dashboard/conversations
// Update a conversation's settings (e.g., can_agents_write permission).
// Body: { conversation_id: string, can_agents_write?: boolean, title?: string }
export async function PATCH(req: NextRequest) {
  const { supabase, user } = await getAuth(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { conversation_id, can_agents_write, title } = body;
  if (!conversation_id) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });

  // Verify the conversation exists and user owns the workspace
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, workspace_id, workspaces(user_id)')
    .eq('id', conversation_id)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });

  const workspaceData = conv.workspaces;
  const workspace = Array.isArray(workspaceData) ? workspaceData[0] : workspaceData;
  if (!workspace || workspace.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof can_agents_write === 'boolean') updates.can_agents_write = can_agents_write;
  if (typeof title === 'string') updates.title = title.trim() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_updates_provided' }, { status: 400 });
  }

  const { error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', conversation_id);

  if (error) return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });

  return NextResponse.json({ success: true, conversation_id, updates });
}
