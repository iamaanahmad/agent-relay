/**
 * Agent Talk REST API end-to-end tests.
 *
 * Runs against the deployed Next.js API routes and the live database using
 * two real user accounts, real agents and real connection tokens.
 *
 * Usage: node tests/agent-talk.e2e.mjs (dev server must be running on :3000)
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE = process.env.AGENT_TALK_BASE_URL ?? 'http://localhost:3000';
const stamp = Date.now();

const admin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

async function signupUser(email, password) {
  const { data, error } = await admin.auth.signUp({ email, password });
  if (error) throw new Error(`signup failed for ${email}: ${error.message}`);
  if (!data.session) throw new Error(`no session returned for ${email} — is email confirmation off?`);
  return data.session.access_token;
}

async function issueToken(userClient, agentId) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const plaintext = 'ar_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: agent, error } = await userClient.from('agents').select('id, workspace_id').eq('id', agentId).maybeSingle();
  if (error || !agent) throw new Error('cannot read agent for token issue');
  const { error: insertErr } = await userClient.from('agent_tokens').insert({
    agent_id: agent.id, workspace_id: agent.workspace_id, token_hash: hash, token_prefix: plaintext.slice(0, 10),
  });
  if (insertErr) throw new Error(`token insert failed: ${insertErr.message}`);
  return plaintext;
}

// --- setup: two users, two workspaces; agent talks only within a workspace ----
console.log('\n== Setup ==\n');

const aliceJwt = await signupUser(`talk-alice-${stamp}@example.com`, `Tq9!vXz#${stamp}aA`);
const bobJwt = await signupUser(`talk-bob-${stamp}@example.com`, `Tq9!vXz#${stamp}bB`);
const alice = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${aliceJwt}` } } });
const bob = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${bobJwt}` } } });

const wsA = (await alice.from('workspaces').insert({ name: `Talk WS A ${stamp}` }).select().single()).data;
const agentA1 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: `talk-sender-${stamp}` }).select().single()).data;
const agentA2 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: `talk-worker-${stamp}` }).select().single()).data;
const tokenA1 = await issueToken(alice, agentA1.id);
const tokenA2 = await issueToken(alice, agentA2.id);

const wsB = (await bob.from('workspaces').insert({ name: `Talk WS B ${stamp}` }).select().single()).data;
const agentB1 = (await bob.from('agents').insert({ workspace_id: wsB.id, name: `talk-sender-${stamp}` }).select().single()).data;
const tokenB1 = await issueToken(bob, agentB1.id);

record('setup: users, workspaces and agents created', !!wsA?.id && !!agentA1?.id && !!agentA2?.id && !!wsB?.id);

// --- 1. authentication -------------------------------------------------------
console.log('\n== Authentication ==\n');

{
  const { status } = await call('POST', '/api/agent-talk/turns', null, { recipient_agent_name: 'x', title: 't', instructions: 'i' });
  record('submit without token rejected (401)', status === 401);
}
{
  const { status } = await call('POST', '/api/agent-talk/turns', 'ar_bogus', { recipient_agent_name: 'x', title: 't', instructions: 'i' });
  record('submit with unknown token rejected (401)', status === 401);
}

// --- 2. successful handoff ---------------------------------------------------
console.log('\n== Successful handoff ==\n');

let taskId;
{
  const { status, data } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`,
    title: 'Summarise notes',
    instructions: 'Return 3 bullets.',
    context: { source: 'notes.md' },
  });
  taskId = data?.task_id;
  record('submit returns 201 with task_id and queued status',
    status === 201 && !!taskId && data.status === 'queued', JSON.stringify(data));
  record('submit response does not imply execution', /not started|accepted/i.test(data?.note ?? ''));
}
{
  const { status, data } = await call('GET', `/api/agent-talk/turns/${taskId}`, tokenA2, null);
  record('recipient sees queued task, no result yet', status === 200 && data.status === 'queued' && data.result === undefined);
}
{
  const { status, data } = await call('POST', `/api/agent-talk/turns/${taskId}/claim`, tokenA2, null);
  record('recipient claims: task returned with running status and full payload',
    status === 200 && data.task?.status === 'running' && data.task?.instructions === 'Return 3 bullets.', JSON.stringify(data));
}
{
  const { status } = await call('POST', `/api/agent-talk/turns/${taskId}/reply`, tokenA2, { status: 'completed', result: { bullets: ['a', 'b', 'c'] } });
  record('recipient replies completed (200)', status === 200);
}
{
  const { status, data } = await call('GET', `/api/agent-talk/turns/${taskId}`, tokenA1, null);
  record('sender retrieves private result', status === 200 && data.status === 'completed' && data.result?.bullets?.length === 3, JSON.stringify(data));
}

// --- 3. claim is single-use --------------------------------------------------
console.log('\n== Claim exclusivity ==\n');

{
  const { data: t2 } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 'Second job', instructions: 'Do it.',
  });
  const first = await call('POST', `/api/agent-talk/turns/${t2.task_id}/claim`, tokenA2, null);
  const second = await call('POST', `/api/agent-talk/turns/${t2.task_id}/claim`, tokenA2, null);
  record('double claim rejected (409)', first.status === 200 && second.status === 409, `first=${first.status} second=${second.status}`);

  const { status: replyStatus } = await call('POST', `/api/agent-talk/turns/${t2.task_id}/reply`, tokenA2, { status: 'completed', result: { ok: true } });
  record('reply after claim works (200)', replyStatus === 200);

  const { data: t3 } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 'Third job', instructions: 'Do it.',
  });
  const { status: replyWithoutClaim } = await call('POST', `/api/agent-talk/turns/${t3.task_id}/reply`, tokenA2, { status: 'completed', result: {} });
  record('reply before claim rejected (409)', replyWithoutClaim === 409);
}

// --- 4. authorization --------------------------------------------------------
console.log('\n== Authorization ==\n');

{
  const { status, data } = await call('POST', '/api/agent-talk/turns', tokenB1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 'Cross-ws', instructions: 'Nope.',
  });
  record('cross-workspace submit rejected (recipient not found, 404)', status === 404 && data.error === 'recipient_not_found');
}
{
  const { status } = await call('GET', `/api/agent-talk/turns/${taskId}`, tokenB1, null);
  record('cross-workspace task read rejected (403/404)', status === 403 || status === 404, `status=${status}`);
}
{
  const { data: t4 } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 'Sender-only cancel', instructions: 'x',
  });
  const { status } = await call('POST', `/api/agent-talk/turns/${t4.task_id}/cancel`, tokenA2, null);
  record('recipient cannot cancel (403)', status === 403);
  const { status: cancelOk } = await call('POST', `/api/agent-talk/turns/${t4.task_id}/cancel`, tokenA1, null);
  record('sender cancels queued task (200)', cancelOk === 200);
  const { status: cancelAgain } = await call('POST', `/api/agent-talk/turns/${t4.task_id}/cancel`, tokenA1, null);
  record('cancelling a cancelled task rejected (409)', cancelAgain === 409);
}

// --- 5. idempotency ----------------------------------------------------------
console.log('\n== Idempotency ==\n');

{
  const body = { recipient_agent_name: `talk-worker-${stamp}`, title: 'Idem job', instructions: 'Once only.', idempotency_key: `idem-${stamp}` };
  const first = await call('POST', '/api/agent-talk/turns', tokenA1, body);
  const second = await call('POST', '/api/agent-talk/turns', tokenA1, body);
  record('duplicate submission returns original task id (deduplicated)',
    first.status === 201 && second.status === 201 && second.data.task_id === first.data.task_id && second.data.deduplicated === true,
    JSON.stringify(second.data));
}

// --- 6. validation / failure cases -------------------------------------------
console.log('\n== Validation and failures ==\n');

{
  const { status } = await call('POST', '/api/agent-talk/turns', tokenA1, { title: 't', instructions: 'i' });
  record('missing recipient rejected (400)', status === 400);
}
{
  const { status } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-sender-${stamp}`, title: 't', instructions: 'i',
  });
  record('sending to yourself rejected (400)', status === 400);
}
{
  const { status } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 'x'.repeat(201), instructions: 'i',
  });
  record('oversized title rejected (400)', status === 400);
}
{
  const { status } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 't', instructions: 'i', context: { big: 'x'.repeat(40000) },
  });
  record('oversized context rejected (413)', status === 413);
}
{
  const { status } = await call('POST', '/api/agent-talk/turns', tokenA1, 'not-json-object');
  record('non-object body rejected (400)', status === 400);
}
{
  const { status } = await call('GET', '/api/agent-talk/turns/not-a-uuid', tokenA1, null);
  record('malformed task id rejected (400)', status === 400);
}
{
  const { data: t5 } = await call('POST', '/api/agent-talk/turns', tokenA1, {
    recipient_agent_name: `talk-worker-${stamp}`, title: 'Fail me', instructions: 'x',
  });
  await call('POST', `/api/agent-talk/turns/${t5.task_id}/claim`, tokenA2, null);
  await call('POST', `/api/agent-talk/turns/${t5.task_id}/reply`, tokenA2, { status: 'failed', error: 'could not read file' });
  const { data: got } = await call('GET', `/api/agent-talk/turns/${t5.task_id}`, tokenA1, null);
  record('failed task surfaces error to sender', got.status === 'failed' && got.error === 'could not read file', JSON.stringify(got));
}

// --- 7. revocation -----------------------------------------------------------
console.log('\n== Revocation ==\n');

{
  const fresh = await issueToken(alice, agentA1.id);
  const before = await call('GET', '/api/agent-talk/turns', fresh, null);
  const { data: rows } = await alice.from('agent_tokens')
    .select('id, token_prefix, revoked_at').order('created_at', { ascending: false }).limit(5);
  const target = rows.find((r) => r.revoked_at === null);
  if (target) {
    await alice.from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', target.id);
  }
  const after = await call('GET', '/api/agent-talk/turns', fresh, null);
  record('revoked token rejected on next request (401)', before.status === 200 && after.status === 401,
    `before=${before.status} after=${after.status}`);
}

// --- summary ------------------------------------------------------------------
console.log(`\n========================================`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failures.length) {
  console.log('Failures:');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('All Agent Talk tests passed.');
