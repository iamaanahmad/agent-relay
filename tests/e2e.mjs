/**
 * Agent Relay end-to-end test suite.
 *
 * Runs against the DEPLOYED Supabase edge function and database using two
 * real user accounts, two agents and real connection tokens — the same path
 * an actual MCP client would take.
 *
 * Usage: node tests/e2e.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env
 * (they are pre-populated in this environment).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// --- env ---------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const stamp = Date.now();

// --- helpers -------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function record(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function mcp(token, body) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

function rpcId({ status, data }) {
  return { status, ok: !!data?.result, error: data?.error, result: data?.result };
}

async function signupUser(email, password) {
  const { data, error } = await admin.auth.signUp({ email, password });
  if (error) throw new Error(`signup failed for ${email}: ${error.message}`);
  if (!data.session) throw new Error(`no session returned for ${email} — is email confirmation off?`);
  return data.session.access_token;
}

async function createUserClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function issueToken(userClient, agentId) {
  // Mint a token the same way the app's /api/agent-tokens route does: random
  // plaintext, only the SHA-256 hash stored. This exercises the real DB path.
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const plaintext = 'ar_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: agent, error } = await userClient
    .from('agents')
    .select('id, workspace_id')
    .eq('id', agentId)
    .maybeSingle();
  if (error || !agent) throw new Error('cannot read agent for token issue');
  const { error: insertErr } = await userClient.from('agent_tokens').insert({
    agent_id: agent.id,
    workspace_id: agent.workspace_id,
    token_hash: hash,
    token_prefix: plaintext.slice(0, 10),
  });
  if (insertErr) throw new Error(`token insert failed: ${insertErr.message}`);
  return plaintext;
}

// --- setup ---------------------------------------------------------------------
console.log('\n== Setup: two users, two workspaces, two agents ==\n');

let aliceToken, bobToken, alice, bob;
try {
  aliceToken = await signupUser(`relay-alice-${stamp}@example.com`, `Tq9!vXz#${stamp}aA`);
  bobToken = await signupUser(`relay-bob-${stamp}@example.com`, `Tq9!vXz#${stamp}bB`);
  alice = await createUserClient(aliceToken);
  bob = await createUserClient(bobToken);
  record('setup: two users created', true);
} catch (err) {
  console.error('Setup failed, aborting:', err.message);
  process.exit(2);
}

const wsA = (await alice.from('workspaces').insert({ name: `Alice WS ${stamp}` }).select().single()).data;
const wsB = (await bob.from('workspaces').insert({ name: `Bob WS ${stamp}` }).select().single()).data;
record('setup: workspaces created', !!wsA?.id && !!wsB?.id);

const agentA1 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: 'alice-coordinator' }).select().single()).data;
const agentA2 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: 'alice-worker' }).select().single()).data;
const agentB1 = (await bob.from('agents').insert({ workspace_id: wsB.id, name: 'bob-worker' }).select().single()).data;
record('setup: agents created', !!agentA1?.id && !!agentA2?.id && !!agentB1?.id);

const tokenA1 = await issueToken(alice, agentA1.id);
const tokenA2 = await issueToken(alice, agentA2.id);
const tokenB1 = await issueToken(bob, agentB1.id);
record('setup: three tokens issued', typeof tokenA1 === 'string' && typeof tokenA2 === 'string' && typeof tokenB1 === 'string');

// --- tests ---------------------------------------------------------------------

console.log('\n== Authentication ==\n');
{
  const r = await mcp('not-a-real-token', { jsonrpc: '2.0', id: 1, method: 'initialize' });
  record('invalid token rejected with 401', r.status === 401, `got ${r.status}`);
}
{
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  record('missing token rejected with 401', r.status === 401, `got ${r.status}`);
}
{
  const r = rpcId(await mcp(tokenA1, { jsonrpc: '2.0', id: 1, method: 'initialize' }));
  record('valid token completes initialize', r.ok && r.result?.serverInfo?.name === 'agent-relay');
}
{
  const r = rpcId(await mcp(tokenA1, { jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  const names = (r.result?.tools ?? []).map((t) => t.name);
  record(
    'tools/list exposes all eight tools',
    ['get_started', 'send_task', 'claim_task', 'update_task', 'check_task', 'get_result', 'list_agents', 'cancel_task'].every((n) => names.includes(n)),
    `got: ${names.join(', ')}`,
  );
}
{
  const r = rpcId(await mcp(tokenA1, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_started', arguments: {} } }));
  const text = r.result?.content?.[0]?.text ?? '';
  record(
    'get_started returns identity, workspace and workflow guide',
    r.ok && text.includes('alice-coordinator') && text.includes('claim_task') && text.includes('workflow'),
    text.slice(0, 80),
  );
}

console.log('\n== Workspace isolation ==\n');
{
  const r = rpcId(await mcp(tokenA1, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_agents', arguments: {} } }));
  const agents = JSON.parse(r.result.content[0].text).agents;
  record('agent A1 sees only its workspace agents', agents.length === 2 && agents.every((a) => a.name.startsWith('alice-')), `saw ${agents.length}`);
}
{
  // Bob (different workspace) tries to read a task created in Alice's workspace.
  const created = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 11, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'cross test', instructions: 'x' } },
  }));
  const taskId = JSON.parse(created.result.content[0].text).task_id;
  const r = rpcId(await mcp(tokenB1, { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'check_task', arguments: { task_id: taskId } } }));
  record('cross-workspace task read rejected', r.ok === false && r.status === 200 && !!r.error, JSON.stringify(r.error ?? {}));
}

console.log('\n== Full delegation cycle (two real MCP clients) ==\n');
{
  // Alice-coordinator delegates to alice-worker.
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 20, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Summarise report', instructions: 'Write a one-line summary.', context: { source: 'q3-report' } } },
  }));
  const { task_id: taskId } = JSON.parse(sent.result.content[0].text);
  record('sender: task created and queued', sent.ok && JSON.parse(sent.result.content[0].text).status === 'queued');

  // Recipient claims it (by id — an older queued task may exist from earlier tests).
  const claimed = rpcId(await mcp(tokenA2, { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } }));
  const claimedTask = JSON.parse(claimed.result.content[0].text).task;
  record('recipient: claimed the queued task', claimed.ok && claimedTask?.id === taskId && claimedTask?.status === 'running');

  // Third agent (Bob's) cannot claim a task not assigned to it.
  const stolen = rpcId(await mcp(tokenB1, { jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } }));
  record('unrelated agent cannot claim another agent\'s task', stolen.ok === false && !!stolen.error, JSON.stringify(stolen.error ?? {}));

  // Recipient submits the result.
  const done = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 23, method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: taskId, status: 'completed', result: { summary: 'Revenue grew 12%.' } } },
  }));
  record('recipient: submitted completed result', done.ok && JSON.parse(done.result.content[0].text).status === 'completed');

  // Sender fetches the result.
  const got = rpcId(await mcp(tokenA1, { jsonrpc: '2.0', id: 24, method: 'tools/call', params: { name: 'get_result', arguments: { task_id: taskId } } }));
  const resultPayload = JSON.parse(got.result.content[0].text);
  record('sender: retrieved the result', got.ok && resultPayload?.result?.summary === 'Revenue grew 12%.');
}

console.log('\n== Approval workflow ==\n');
{
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 30, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Sensitive op', instructions: 'Needs human sign-off.', requires_approval: true } },
  }));
  const { task_id: taskId, status } = JSON.parse(sent.result.content[0].text);
  record('approval-flagged task created as awaiting_approval', status === 'awaiting_approval');

  // Recipient cannot claim while awaiting approval.
  const early = rpcId(await mcp(tokenA2, { jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'claim_task', arguments: {} } }));
  const earlyPayload = early.result ? JSON.parse(early.result.content[0].text) : null;
  const earlyTask = earlyPayload?.task ?? null;
  record('recipient cannot claim before approval', earlyTask === null || earlyTask?.id !== taskId);

  // Alice approves via the dashboard path (direct DB update as owner).
  const { error: approveErr } = await alice
    .from('tasks')
    .update({ status: 'queued', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('status', 'awaiting_approval');
  record('owner approved via dashboard (RLS allowed)', !approveErr, approveErr?.message);

  // Now the recipient can claim and complete it.
  const claimed = rpcId(await mcp(tokenA2, { jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } }));
  const claimedTask = JSON.parse(claimed.result.content[0].text).task;
  record('recipient claimed after approval', claimed.ok && claimedTask?.id === taskId && claimedTask?.status === 'running');
  const done = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 33, method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: taskId, status: 'completed', result: { done: true } } },
  }));
  record('recipient completed approved task', done.ok);
}

console.log('\n== Task state machine ==\n');
{
  // Invalid transition: completed -> running must be rejected by the trigger.
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 40, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'State machine test', instructions: 'x' } },
  }));
  const { task_id: taskId } = JSON.parse(sent.result.content[0].text);

  // Complete it without claiming — should fail (must be running first).
  const premature = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 41, method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: taskId, status: 'completed', result: { x: 1 } } },
  }));
  record('cannot complete a queued task (must claim first)', premature.ok === false && !!premature.error);

  // Claim, complete, then try to move it back to running — must fail.
  await mcp(tokenA2, { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } });
  await mcp(tokenA2, { jsonrpc: '2.0', id: 43, method: 'tools/call', params: { name: 'update_task', arguments: { task_id: taskId, status: 'completed', result: { x: 1 } } } });
  const reopen = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 44, method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: taskId, status: 'running' } },
  }));
  record('cannot reopen a completed task', reopen.ok === false && !!reopen.error);

  // completed -> queued directly via owner DB update must also fail (trigger).
  const { error: dbErr } = await alice
    .from('tasks')
    .update({ status: 'queued' })
    .eq('id', taskId);
  record('database trigger blocks completed -> queued', !!dbErr);
}

console.log('\n== Failed tasks and audit trail ==\n');
{
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 50, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Will fail', instructions: 'x' } },
  }));
  const { task_id: taskId } = JSON.parse(sent.result.content[0].text);
  await mcp(tokenA2, { jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } });
  const failed = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 52, method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: taskId, status: 'failed', error: 'upstream API returned 500' } },
  }));
  record('recipient: marked task failed with error message', failed.ok);

  const { data: events } = await alice.from('task_events').select('event_type').eq('task_id', taskId);
  const types = events.map((e) => e.event_type);
  record('audit trail recorded the full lifecycle', ['created', 'claimed', 'failed'].every((t) => types.includes(t)), types.join(','));
}

console.log('\n== Cancellation ==\n');
{
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 60, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Cancel me', instructions: 'x' } },
  }));
  const { task_id: taskId } = JSON.parse(sent.result.content[0].text);

  const cancelled = rpcId(await mcp(tokenA1, { jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'cancel_task', arguments: { task_id: taskId } } }));
  record('sender cancelled a queued task', cancelled.ok);

  // Recipient tries to claim the cancelled task — must not find it.
  const claimed = rpcId(await mcp(tokenA2, { jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } }));
  const taskText = claimed.result ? JSON.parse(claimed.result.content[0].text) : null;
  const t = taskText?.task ?? null;
  record('cancelled task cannot be claimed', t === null || t?.id !== taskId);
}

console.log('\n== Duplicate / concurrent requests ==\n');
{
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 70, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Race test', instructions: 'x' } },
  }));
  const { task_id: taskId } = JSON.parse(sent.result.content[0].text);

  // 6 concurrent claim attempts on the same task.
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      mcp(tokenA2, { jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: taskId } } })),
  );
  const winners = results.filter((r) => rpcId(r).ok).length;
  record('exactly one concurrent claim wins', winners === 1, `${winners} claims succeeded`);
}

console.log('\n== Token revocation ==\n');
{
  // Issue a fresh token for alice-worker, revoke it, verify rejection.
  const fresh = await issueToken(alice, agentA2.id);

  const before = await mcp(fresh, { jsonrpc: '2.0', id: 80, method: 'initialize' });
  record('fresh token works before revocation', before.status === 200);

  const { data: tokRow } = await alice.from('agent_tokens').select('id').eq('token_prefix', fresh.slice(0, 10)).maybeSingle();
  await alice.from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokRow.id);

  const after = await mcp(fresh, { jsonrpc: '2.0', id: 81, method: 'initialize' });
  record('revoked token rejected with 401', after.status === 401, `got ${after.status}`);
}

console.log('\n== Rate limiting ==\n');
{
  // Fire 105 rapid requests with tokenB1 and count how many get 429.
  const responses = await Promise.all(
    Array.from({ length: 105 }, (_, i) =>
      mcp(tokenB1, { jsonrpc: '2.0', id: 90 + i, method: 'ping' })),
  );
  const limited = responses.filter((r) => r.status === 429).length;
  const ok = responses.filter((r) => r.status === 200).length;
  record('rate limit kicked in at 100/min', limited > 0 && ok <= 100, `${ok} ok, ${limited} limited`);
}

console.log('\n== Task input validation ==\n');
{
  const missing = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 100, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: '', instructions: 'x' } },
  }));
  record('send_task rejects empty title', missing.ok === false && !!missing.error);

  const selfSend = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 101, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-coordinator', title: 'x', instructions: 'x' } },
  }));
  record('agent cannot send a task to itself', selfSend.ok === false && !!selfSend.error);

  const ghost = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 102, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'bob-worker', title: 'x', instructions: 'x' } },
  }));
  record('cannot address an agent in another workspace', ghost.ok === false && !!ghost.error, JSON.stringify(ghost.error ?? {}));
}

console.log('\n== Frontend ownership (RLS) ==\n');
{
  // Bob tries to read Alice's agents directly through the database.
  const { data: stolenAgents } = await bob.from('agents').select('*').eq('workspace_id', wsA.id);
  record('RLS blocks cross-user agent reads', (stolenAgents ?? []).length === 0);

  // Bob tries to read Alice's token hashes.
  const { data: stolenTokens } = await bob.from('agent_tokens').select('*').eq('workspace_id', wsA.id);
  record('RLS blocks cross-user token reads', (stolenTokens ?? []).length === 0);

  // Alice tries to forge an audit event for an agent-sent task.
  const { data: agentTask } = await alice
    .from('tasks')
    .select('id')
    .eq('workspace_id', wsA.id)
    .not('sender_agent_id', 'is', null)
    .limit(1)
    .maybeSingle();
  const { error: forgeErr } = await alice.from('task_events').insert({
    task_id: agentTask.id,
    workspace_id: wsA.id,
    event_type: 'completed',
    actor: 'agent:alice-coordinator',
    detail: {},
  });
  record('RLS blocks forging agent audit events', !!forgeErr);
}

console.log('\n== Audit regressions ==\n');
{
  // 1. Trigger function not callable via the Data API.
  const { error: rpcErr } = await alice.rpc('enforce_task_transition');
  record('enforce_task_transition not callable via Data API', !!rpcErr, rpcErr?.message);

  // 2. Approved-after-timeout task must NOT be insta-cancelled.
  const sent = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 110, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Slow approval', instructions: 'x', requires_approval: true, timeout_minutes: 1 } },
  }));
  const slowId = JSON.parse(sent.result.content[0].text).task_id;
  // Simulate a slow human: approve exactly past the 1-minute timeout window.
  await new Promise((r) => setTimeout(r, 61000));
  const { error: apprErr } = await alice
    .from('tasks')
    .update({ status: 'queued', approved_at: new Date().toISOString() })
    .eq('id', slowId);
  const after = rpcId(await mcp(tokenA2, { jsonrpc: '2.0', id: 111, method: 'tools/call', params: { name: 'claim_task', arguments: { task_id: slowId } } }));
  const afterTask = after.result ? JSON.parse(after.result.content[0].text).task : null;
  record('approval resets the queue timeout clock', !apprErr && afterTask?.id === slowId && afterTask?.status === 'running', JSON.stringify(afterTask?.status ?? after.error));

  // 3. update_task cannot silently claim a queued task.
  const sent2 = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 112, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'No side-door', instructions: 'x' } },
  }));
  const sideId = JSON.parse(sent2.result.content[0].text).task_id;
  const bypass = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 113, method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: sideId, status: 'running' } },
  }));
  record('update_task cannot claim a queued task (must use claim_task)', bypass.ok === false, JSON.stringify(bypass.error ?? {}));

  // 4. send_task idempotency: identical retry returns the same task.
  const first = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 114, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Idempotent send', instructions: 'same content' } },
  }));
  const second = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 115, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Idempotent send', instructions: 'same content' } },
  }));
  const firstId = JSON.parse(first.result.content[0].text).task_id;
  const secondPayload = JSON.parse(second.result.content[0].text);
  record('identical retried send returns the original task', secondPayload.task_id === firstId && secondPayload.deduplicated === true, JSON.stringify(secondPayload));

  // 4b. Explicit distinct keys create distinct tasks despite identical content.
  const third = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 116, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Idempotent send', instructions: 'same content', idempotency_key: `distinct-${stamp}` } },
  }));
  const thirdId = JSON.parse(third.result.content[0].text).task_id;
  record('client key creates a distinct task despite identical content', third.ok && thirdId !== firstId);

  // 5. Oversized payloads rejected.
  const big = 'x'.repeat(40000);
  const huge = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 117, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Big', instructions: 'x', context: { blob: big } } },
  }));
  record('oversized context payload rejected', huge.ok === false, JSON.stringify(huge.error ?? {}));

  // 6. JSON-RPC notifications get no response body.
  const note = await mcp(tokenA1, { jsonrpc: '2.0', method: 'notifications/initialized' });
  record('notifications receive no JSON-RPC response', note.status === 202 && note.data === null, `status ${note.status}`);

  // 7. Unauthorized side effects: alice-worker (recipient) cannot cancel a task it received.
  const sent3 = rpcId(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 118, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: 'alice-worker', title: 'Not yours to cancel', instructions: 'x' } },
  }));
  const notYours = JSON.parse(sent3.result.content[0].text).task_id;
  const cancelAttempt = rpcId(await mcp(tokenA2, {
    jsonrpc: '2.0', id: 119, method: 'tools/call',
    params: { name: 'cancel_task', arguments: { task_id: notYours } },
  }));
  record('recipient cannot cancel a task it did not send', cancelAttempt.ok === false, JSON.stringify(cancelAttempt.error ?? {}));
}

// --- summary ---------------------------------------------------------------------
console.log(`\n========================================`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failures.length) {
  console.log('Failed tests:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('All tests passed.');
