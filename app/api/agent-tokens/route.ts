import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Generates a connection token for an agent. The plaintext token is returned to
// the caller exactly once and only its SHA-256 hash is persisted. Access is
// enforced by Supabase RLS using the user's session cookie.
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    let supabase;

    if (authHeader) {
      supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false },
        },
      );
    } else {
      // Fall back to cookie-based session (ssr).
      const { createServerClient } = await import('@supabase/ssr');
      const cookieStore = req.cookies;
      supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => cookieStore.getAll(),
            setAll: () => {},
          },
        },
      );
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const agentId = typeof body?.agent_id === 'string' ? body.agent_id : '';
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    // RLS ensures the agent row is only visible if its workspace belongs to the
    // caller, so this lookup doubles as the ownership check.
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('id, workspace_id')
      .eq('id', agentId)
      .maybeSingle();

    if (agentErr || !agent) {
      return NextResponse.json({ error: 'Agent not found or not accessible' }, { status: 404 });
    }

    // Generate a cryptographically random opaque token.
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const plaintext = 'ar_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Store only the hash.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { error: insertErr } = await supabase.from('agent_tokens').insert({
      agent_id: agent.id,
      workspace_id: agent.workspace_id,
      token_hash: hash,
      token_prefix: plaintext.slice(0, 10),
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ token: plaintext });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
