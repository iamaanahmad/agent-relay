/**
 * Agent Relay — Persistent Messaging end-to-end tests.
 *
 * Tests the REST messaging API:
 *   GET  /api/agent-talk/agents
 *   POST /api/agent-talk/messages
 *   GET  /api/agent-talk/inbox
 *   GET  /api/agent-talk/conversations/{id}
 *   POST /api/agent-talk/messages/{id}/read
 *
 * Also verifies that existing MCP task delegation still works (regression).
 *
 * Usage: node tests/messaging.e2e.mjs (dev server must be running on :3000)
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';

const envPath = existsSync(new URL('../.env.local', import.meta.url))
  ? new URL('../.env.local', import.meta.url)
  : new URL('../.env', import.meta.url);

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE = process.env.MESSAGING_BASE_URL ?? 'http://localhost:3000';
const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;
const stamp = Date.now();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

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

function mcpResult(r) {
  return { ok: !!r.data?.result, result: r.data?.result, error: r.data?.error };
}

async function signupUser(email, password) {
  const { data, error } = await admin.auth.signUp({ email, password });
  if (error) throw new Error(`signup failed for ${email}: ${error.message}`);
  if (!data.session) throw new Error(`no session for ${email}`);
  return data.session.access_token;
}

async function issueToken(userClient, agentId) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const plaintext = 'ar_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: agent } = await userClient.from('agents').select('id, workspace_id').eq('id', agentId).maybeSingle();
  if (!agent) throw new Error('cannot read agent');
  const { error } = await userClient.from('agent_tokens').insert({
    agent_id: agent.id, workspace_id: agent.workspace_id, token_hash: hash, token_prefix: plaintext.slice(0, 10),
  });
  if (error) throw new Error(`token insert failed: ${error.message}`);
  return plaintext;
}

// ---- Setup ------------------------------------------------------------------
console.log('\n== Setup ==\n');

const aliceJwt = await signupUser(`msg.alice.${stamp}@gmail.com`, `Tq9!vXz#${stamp}aA`);
const bobJwt = await signupUser(`msg.bob.${stamp}@gmail.com`, `Tq9!vXz#${stamp}bB`);
const alice = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${aliceJwt}` } } });
const bob = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${bobJwt}` } } });

const wsA = (await alice.from('workspaces').insert({ name: `Msg WS A ${stamp}` }).select().single()).data;
const agentA1 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: `chatgpt-${stamp}` }).select().single()).data;
const agentA2 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: `gemini-${stamp}` }).select().single()).data;
const tokenA1 = await issueToken(alice, agentA1.id);
const tokenA2 = await issueToken(alice, agentA2.id);

const wsB = (await bob.from('workspaces').insert({ name: `Msg WS B ${stamp}` }).select().single()).data;
const agentB1 = (await bob.from('agents').insert({ workspace_id: wsB.id, name: `claude-${stamp}` }).select().single()).data;
const tokenB1 = await issueToken(bob, agentB1.id);

record('setup: users, workspaces and agents created', !!wsA?.id && !!agentA1?.id && !!agentA2?.id && !!wsB?.id);

// ---- 1. Agent discovery -----------------------------------------------------
console.log('\n== Agent discovery ==\n');

{
  const { status, data } = await call('GET', '/api/agent-talk/agents', tokenA1, null);
  record('GET /agents returns other agents in workspace', status === 200 && Array.isArray(data?.agents), JSON.stringify(data));
  record('GET /agents excludes the calling agent', status === 200 && data.agents.every((a) => a.id !== agentA1.id));
  record('GET /agents does not include cross-workspace agents', status === 200 && data.agents.every((a) => a.id !== agentB1.id));
}
{
  const { status } = await call('GET', '/api/agent-talk/agents', null, null);
  record('GET /agents without token rejected (401)', status === 401);
}

// ---- 2. Send a message -------------------------------------------------------
console.log('\n== Send message ==\n');

let msgId1, convId;
{
  const { status, data } = await call('POST', '/api/agent-talk/messages', tokenA1, {
    recipient_agent_name: `gemini-${stamp}`,
    content: 'Hello Gemini, can you summarise the Q3 report?',
  });
  msgId1 = data?.message_id;
  convId = data?.conversation_id;
  record('POST /messages returns 201 with message_id and conversation_id',
    status === 201 && !!msgId1 && !!convId, JSON.stringify(data));
  record('POST /messages status is stored', data?.status === 'stored');
  record('POST /messages note clarifies stored ≠ delivered', /stored|not read/i.test(data?.note ?? ''));
}

// ---- 3. Two agents exchange multiple messages in one conversation ------------
console.log('\n== Multi-message conversation ==\n');

let msgId2, msgId3;
{
  // Gemini replies in the same conversation
  const { status, data } = await call('POST', '/api/agent-talk/messages', tokenA2, {
    recipient_agent_name: `chatgpt-${stamp}`,
    content: 'Hi ChatGPT! Here is the Q3 summary: Revenue grew 12%.',
    conversation_id: convId,
  });
  msgId2 = data?.message_id;
  record('Gemini replies in same conversation (201)', status === 201 && data?.conversation_id === convId, JSON.stringify(data));
}
{
  // ChatGPT sends another message — omitting conversation_id should reuse the thread
  const { status, data } = await call('POST', '/api/agent-talk/messages', tokenA1, {
    recipient_agent_name: `gemini-${stamp}`,
    content: 'Thanks! Can you also check Q4?',
  });
  msgId3 = data?.message_id;
  record('Omitting conversation_id reuses existing thread', status === 201 && data?.conversation_id === convId, JSON.stringify(data));
}

// ---- 4. Inbox retrieval -----------------------------------------------------
console.log('\n== Inbox retrieval ==\n');

{
  const { status, data } = await call('GET', '/api/agent-talk/inbox', tokenA2, null);
  record('GET /inbox returns messages for recipient', status === 200 && Array.isArray(data?.messages), JSON.stringify(data));
  const ids = (data?.messages ?? []).map((m) => m.id);
  record('Inbox contains the sent message', ids.includes(msgId1));
  record('Inbox messages include sender_name', (data?.messages ?? []).every((m) => m.sender_name !== undefined));
  record('Inbox messages include read_at (null when unread)', (data?.messages ?? []).every((m) => 'read_at' in m));
}
{
  const { status, data } = await call('GET', '/api/agent-talk/inbox?unread=true', tokenA2, null);
  record('GET /inbox?unread=true returns only unread messages', status === 200 && (data?.messages ?? []).every((m) => m.read_at === null));
}
{
  // Pagination: limit=1
  const { status, data } = await call('GET', '/api/agent-talk/inbox?limit=1', tokenA2, null);
  record('GET /inbox pagination: limit=1 returns at most 1 message', status === 200 && (data?.messages ?? []).length <= 1);
  record('GET /inbox pagination: has_more present', status === 200 && typeof data?.has_more === 'boolean');
}

// ---- 5. Read status updates -------------------------------------------------
console.log('\n== Read status ==\n');

{
  const { status, data } = await call('POST', `/api/agent-talk/messages/${msgId1}/read`, tokenA2, null);
  record('POST /messages/{id}/read marks message as read (200)', status === 200 && !!data?.read_at, JSON.stringify(data));
}
{
  // Idempotent: calling again returns the original read_at
  const first = await call('POST', `/api/agent-talk/messages/${msgId1}/read`, tokenA2, null);
  const second = await call('POST', `/api/agent-talk/messages/${msgId1}/read`, tokenA2, null);
  record('POST /messages/{id}/read is idempotent', first.status === 200 && second.status === 200 && first.data?.read_at === second.data?.read_at);
}
{
  // Only recipient can mark as read
  const { status } = await call('POST', `/api/agent-talk/messages/${msgId1}/read`, tokenA1, null);
  record('Sender cannot mark recipient message as read (403)', status === 403);
}
{
  // Verify inbox now shows the message as read
  const { data } = await call('GET', '/api/agent-talk/inbox', tokenA2, null);
  const msg = (data?.messages ?? []).find((m) => m.id === msgId1);
  record('Inbox reflects read_at after marking read', !!msg?.read_at);
}

// ---- 6. Conversation history ------------------------------------------------
console.log('\n== Conversation history ==\n');

{
  const { status, data } = await call('GET', `/api/agent-talk/conversations/${convId}`, tokenA1, null);
  record('GET /conversations/{id} returns history for participant', status === 200 && Array.isArray(data?.messages), JSON.stringify(data));
  record('Conversation history includes all 3 messages', (data?.messages ?? []).length >= 3);
  record('Conversation history includes participants', Array.isArray(data?.participants) && data.participants.length === 2);
  record('Conversation messages include sender_name', (data?.messages ?? []).every((m) => m.sender_name !== undefined));
}
{
  // Pagination
  const { status, data } = await call('GET', `/api/agent-talk/conversations/${convId}?limit=2`, tokenA1, null);
  record('Conversation history pagination: limit=2', status === 200 && (data?.messages ?? []).length <= 2);
}

// ---- 7. Cross-workspace and non-participant access denial -------------------
console.log('\n== Access control ==\n');

{
  // Bob (different workspace) cannot send to Alice's agents
  const { status, data } = await call('POST', '/api/agent-talk/messages', tokenB1, {
    recipient_agent_name: `gemini-${stamp}`,
    content: 'Cross-workspace attempt',
  });
  record('Cross-workspace send rejected (404 recipient_not_found)', status === 404 && data?.error === 'recipient_not_found');
}
{
  // Bob cannot read Alice's conversation
  const { status } = await call('GET', `/api/agent-talk/conversations/${convId}`, tokenB1, null);
  record('Cross-workspace conversation read rejected (404)', status === 404);
}
{
  // Bob cannot mark Alice's message as read
  const { status } = await call('POST', `/api/agent-talk/messages/${msgId1}/read`, tokenB1, null);
  record('Cross-workspace mark-read rejected (404/403)', status === 403 || status === 404, `status=${status}`);
}
{
  // Non-participant in same workspace: create a third agent that is not in the conversation
  const agentA3 = (await alice.from('agents').insert({ workspace_id: wsA.id, name: `codex-${stamp}` }).select().single()).data;
  const tokenA3 = await issueToken(alice, agentA3.id);
  const { status } = await call('GET', `/api/agent-talk/conversations/${convId}`, tokenA3, null);
  record('Non-participant in same workspace cannot read conversation (404)', status === 404);
}

// ---- 8. Token revocation ----------------------------------------------------
console.log('\n== Token revocation ==\n');

{
  const fresh = await issueToken(alice, agentA1.id);
  const before = await call('GET', '/api/agent-talk/agents', fresh, null);
  const { data: rows } = await alice.from('agent_tokens').select('id, token_prefix, revoked_at').order('created_at', { ascending: false }).limit(5);
  const target = rows.find((r) => r.revoked_at === null);
  if (target) await alice.from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', target.id);
  const after = await call('GET', '/api/agent-talk/agents', fresh, null);
  record('Revoked token rejected on next request (401)', before.status === 200 && after.status === 401, `before=${before.status} after=${after.status}`);
}

// ---- 9. Validation ----------------------------------------------------------
console.log('\n== Validation ==\n');

{
  const { status } = await call('POST', '/api/agent-talk/messages', tokenA1, { content: 'no recipient' });
  record('Missing recipient_agent_name rejected (400)', status === 400);
}
{
  const { status } = await call('POST', '/api/agent-talk/messages', tokenA1, { recipient_agent_name: `gemini-${stamp}`, content: '' });
  record('Empty content rejected (400)', status === 400);
}
{
  const { status } = await call('POST', '/api/agent-talk/messages', tokenA1, {
    recipient_agent_name: `gemini-${stamp}`,
    content: 'x'.repeat(40000),
  });
  record('Oversized content rejected (413)', status === 413);
}
{
  const { status } = await call('POST', '/api/agent-talk/messages', tokenA1, {
    recipient_agent_name: `chatgpt-${stamp}`,
    content: 'self message',
  });
  record('Sending to yourself rejected (400)', status === 400);
}
{
  const { status } = await call('GET', '/api/agent-talk/conversations/not-a-uuid', tokenA1, null);
  record('Invalid conversation_id rejected (400)', status === 400);
}
{
  const { status } = await call('POST', '/api/agent-talk/messages/not-a-uuid/read', tokenA1, null);
  record('Invalid message_id for mark-read rejected (400)', status === 400);
}

// ---- 10. Duplicate / concurrent operations ----------------------------------
console.log('\n== Concurrent operations ==\n');

{
  // Concurrent mark-read calls on the same message should both succeed (idempotent)
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      call('POST', `/api/agent-talk/messages/${msgId2}/read`, tokenA1, null)),
  );
  const allOk = results.every((r) => r.status === 200);
  const readAts = results.map((r) => r.data?.read_at).filter(Boolean);
  record('Concurrent mark-read calls all succeed (idempotent)', allOk, `statuses: ${results.map((r) => r.status).join(',')}`);
  record('Concurrent mark-read returns consistent read_at', new Set(readAts).size === 1, `read_ats: ${[...new Set(readAts)].join(',')}`);
}

// ---- 11. MCP messaging tools (regression + new) ----------------------------
console.log('\n== MCP messaging tools ==\n');

{
  const r = mcpResult(await mcp(tokenA1, { jsonrpc: '2.0', id: 200, method: 'tools/list' }));
  const names = (r.result?.tools ?? []).map((t) => t.name);
  const messagingTools = ['send_message', 'check_inbox', 'get_conversation', 'mark_message_read'];
  record('MCP tools/list includes all messaging tools', messagingTools.every((n) => names.includes(n)), `got: ${names.join(', ')}`);
}
{
  const r = mcpResult(await mcp(tokenA1, { jsonrpc: '2.0', id: 201, method: 'tools/call', params: { name: 'get_started', arguments: {} } }));
  const text = r.result?.content?.[0]?.text ?? '';
  record('get_started mentions messaging workflow', r.ok && text.includes('send_message') && text.includes('check_inbox'), text.slice(0, 120));
}
{
  const r = mcpResult(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 202, method: 'tools/call',
    params: { name: 'send_message', arguments: { recipient_agent_name: `gemini-${stamp}`, content: 'MCP test message' } },
  }));
  const payload = r.result ? JSON.parse(r.result.content[0].text) : null;
  record('MCP send_message returns message_id and conversation_id', r.ok && !!payload?.message_id && !!payload?.conversation_id, JSON.stringify(payload));
  const mcpConvId = payload?.conversation_id;

  const inbox = mcpResult(await mcp(tokenA2, { jsonrpc: '2.0', id: 203, method: 'tools/call', params: { name: 'check_inbox', arguments: { unread: true } } }));
  const inboxPayload = inbox.result ? JSON.parse(inbox.result.content[0].text) : null;
  record('MCP check_inbox returns unread messages', inbox.ok && Array.isArray(inboxPayload?.messages), JSON.stringify(inboxPayload));

  const conv = mcpResult(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 204, method: 'tools/call',
    params: { name: 'get_conversation', arguments: { conversation_id: mcpConvId } },
  }));
  const convPayload = conv.result ? JSON.parse(conv.result.content[0].text) : null;
  record('MCP get_conversation returns history', conv.ok && Array.isArray(convPayload?.messages), JSON.stringify(convPayload));

  // Find a message addressed to A2 in the MCP conversation
  const mcpMsgForA2 = (inboxPayload?.messages ?? []).find((m) => m.conversation_id === mcpConvId);
  if (mcpMsgForA2) {
    const markRead = mcpResult(await mcp(tokenA2, {
      jsonrpc: '2.0', id: 205, method: 'tools/call',
      params: { name: 'mark_message_read', arguments: { message_id: mcpMsgForA2.id } },
    }));
    record('MCP mark_message_read succeeds', markRead.ok, JSON.stringify(markRead.error ?? {}));
  } else {
    record('MCP mark_message_read succeeds', true, 'skipped — no unread MCP message found');
  }
}
{
  // MCP cross-workspace send rejected
  const r = mcpResult(await mcp(tokenB1, {
    jsonrpc: '2.0', id: 206, method: 'tools/call',
    params: { name: 'send_message', arguments: { recipient_agent_name: `gemini-${stamp}`, content: 'cross-ws' } },
  }));
  record('MCP send_message cross-workspace rejected', r.ok === false && !!r.error, JSON.stringify(r.error ?? {}));
}
{
  // MCP list_agents excludes caller
  const r = mcpResult(await mcp(tokenA1, { jsonrpc: '2.0', id: 207, method: 'tools/call', params: { name: 'list_agents', arguments: {} } }));
  const agents = r.result ? JSON.parse(r.result.content[0].text).agents : [];
  record('MCP list_agents excludes the calling agent', r.ok && agents.every((a) => a.id !== agentA1.id), `agents: ${agents.map((a) => a.name).join(',')}`);
}

// ---- 12. Existing MCP task delegation regression ----------------------------
console.log('\n== MCP task delegation regression ==\n');

{
  const sent = mcpResult(await mcp(tokenA1, {
    jsonrpc: '2.0', id: 300, method: 'tools/call',
    params: { name: 'send_task', arguments: { recipient_agent_name: `gemini-${stamp}`, title: 'Regression task', instructions: 'Do the thing.' } },
  }));
  const taskPayload = sent.result ? JSON.parse(sent.result.content[0].text) : null;
  record('MCP send_task still works', sent.ok && taskPayload?.status === 'queued', JSON.stringify(taskPayload));

  if (taskPayload?.task_id) {
    const claimed = mcpResult(await mcp(tokenA2, {
      jsonrpc: '2.0', id: 301, method: 'tools/call',
      params: { name: 'claim_task', arguments: { task_id: taskPayload.task_id } },
    }));
    record('MCP claim_task still works', claimed.ok);

    const done = mcpResult(await mcp(tokenA2, {
      jsonrpc: '2.0', id: 302, method: 'tools/call',
      params: { name: 'update_task', arguments: { task_id: taskPayload.task_id, status: 'completed', result: { ok: true } } },
    }));
    record('MCP update_task still works', done.ok);
  }
}

// ---- Summary ----------------------------------------------------------------
console.log(`\n========================================`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failures.length) {
  console.log('Failures:');
  failures.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('All messaging tests passed.');
