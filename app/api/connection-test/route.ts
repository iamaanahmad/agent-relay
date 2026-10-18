// Agent Relay connection diagnostics endpoint.
// Browser-facing: verifies an agent token against the live MCP endpoint and
// reports exactly what a failing setup got wrong (token invalid vs revoked vs
// rate limited vs endpoint down). Accepts no secrets in the body beyond the
// token being tested, and returns no data beyond pass/fail diagnostics.

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const mcpUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp`;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const token = typeof (body as { token?: unknown })?.token === 'string' ? (body as { token: string }).token.trim() : '';
  if (!token) {
    return NextResponse.json({ ok: false, stage: 'input', message: 'Paste a connection token first.' }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      stage: 'network',
      message: 'Could not reach the Agent Relay endpoint. Check your internet connection and try again.',
    });
  }

  if (res.status === 401) {
    return NextResponse.json({
      ok: false,
      stage: 'auth',
      message: 'This token was rejected. It may have been revoked, or copied incorrectly — generate a new one from the agent page.',
    });
  }
  if (res.status === 429) {
    return NextResponse.json({
      ok: false,
      stage: 'rate_limit',
      message: 'Token is valid but hit the rate limit (100 requests/minute). Wait a minute and retry — no action needed.',
    });
  }
  if (res.status === 503) {
    return NextResponse.json({
      ok: false,
      stage: 'server',
      message: 'Agent Relay is temporarily unavailable. Try again shortly; if it persists, contact support.',
    });
  }

  let data: { result?: { serverInfo?: { name?: string } } } | null = null;
  try {
    data = await res.json();
  } catch {
    // fall through with data = null
  }

  if (res.status !== 200 || !data?.result?.serverInfo) {
    return NextResponse.json({
      ok: false,
      stage: 'server',
      message: `Unexpected response from the endpoint (status ${res.status}).`,
    });
  }

  return NextResponse.json({
    ok: true,
    stage: 'connected',
    message: 'Connection succeeded — this token is live and the MCP endpoint is responding.',
    server: data.result.serverInfo,
  });
}
