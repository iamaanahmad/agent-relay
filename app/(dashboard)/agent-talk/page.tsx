'use client';

import { useState, useEffect } from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { useMessages, useConversations } from '@/lib/hooks';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, MessageSquare, Inbox, MessagesSquare, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Message } from '@/lib/types';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(text); toast({ title: 'Copied' }); }}>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      <pre className="rounded-md border bg-muted/50 p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function MessageRow({ msg, onMarkRead }: {
  msg: Message & { sender_name: string | null; read_at: string | null };
  onMarkRead: (id: string) => void;
}) {
  return (
    <div className={`rounded-lg border p-4 space-y-2 ${!msg.read_at ? 'border-primary/40 bg-primary/5' : 'bg-background'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{msg.sender_name ?? msg.sender_agent_id.slice(0, 8)}</span>
            <span className="text-xs text-muted-foreground">→ you</span>
            {!msg.read_at && <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">Unread</Badge>}
            {msg.read_at && <Badge variant="outline" className="text-xs text-muted-foreground">Read {formatWhen(msg.read_at)}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{formatWhen(msg.created_at)}</p>
        </div>
        {!msg.read_at && (
          <Button size="sm" variant="outline" onClick={() => onMarkRead(msg.id)}>
            Mark read
          </Button>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
      <p className="text-xs text-muted-foreground font-mono">conversation: {msg.conversation_id}</p>
    </div>
  );
}

export default function AgentTalkPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const { messages, loading: msgsLoading, unreadCount, refresh: refreshMessages } = useMessages(10000);
  const { conversations, loading: convsLoading } = useConversations();
  const [origin, setOrigin] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<(Message & { sender_name: string | null; read_at: string | null })[]>([]);
  const [convLoading, setConvLoading] = useState(false);

  useEffect(() => { setOrigin(window.location.origin); }, []);

  async function handleMarkRead(messageId: string) {
    const supabase = getSupabaseBrowserClient();
    await supabase.from('message_reads').upsert({ message_id: messageId, read_at: new Date().toISOString() }, { onConflict: 'message_id,agent_id' });
    refreshMessages();
    toast({ title: 'Marked as read' });
  }

  async function loadConversation(convId: string) {
    setSelectedConvId(convId);
    setConvLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase
      .from('messages')
      .select('*, agents!messages_sender_agent_id_fkey(name)')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) {
      const msgIds = data.map((m: { id: string }) => m.id);
      const { data: reads } = msgIds.length > 0
        ? await supabase.from('message_reads').select('message_id, read_at').in('message_id', msgIds)
        : { data: [] };
      const readMap = new Map((reads ?? []).map((r: { message_id: string; read_at: string }) => [r.message_id, r.read_at]));
      setConvMessages(data.map((m: Message & { agents: { name: string } | null }) => ({
        ...m,
        sender_name: m.agents?.name ?? null,
        read_at: readMap.get(m.id) ?? null,
      })));
    }
    setConvLoading(false);
  }

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Messaging</CardTitle>
          <CardDescription>Create a workspace first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const inboxMessages = messages.filter((m) => true); // all received messages shown in inbox tab
  const selectedConv = conversations.find((c) => c.id === selectedConvId);

  const apiExamples = `# 1. Discover agents
curl -s "${origin}/api/agent-talk/agents" \\
  -H "Authorization: Bearer $TOKEN"

# 2. Send a message (starts or continues a thread)
curl -s -X POST "${origin}/api/agent-talk/messages" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"recipient_agent_name":"gemini-1","content":"Can you summarise the Q3 report?"}'

# 3. Check inbox for replies
curl -s "${origin}/api/agent-talk/inbox?unread=true" \\
  -H "Authorization: Bearer $TOKEN"

# 4. Get full conversation thread
curl -s "${origin}/api/agent-talk/conversations/$CONV_ID" \\
  -H "Authorization: Bearer $TOKEN"

# 5. Mark a message as read
curl -s -X POST "${origin}/api/agent-talk/messages/$MSG_ID/read" \\
  -H "Authorization: Bearer $TOKEN"`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Messaging</h1>
        <p className="text-sm text-muted-foreground">
          Persistent AI-to-AI messages in {activeWorkspace.name}. Stored messages are not proof of delivery or execution.
        </p>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">
            Inbox
            {unreadCount > 0 && (
              <Badge className="ml-2 h-5 min-w-5 px-1.5 text-xs">{unreadCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="conversations">Conversations ({conversations.length})</TabsTrigger>
          <TabsTrigger value="api">API &amp; Examples</TabsTrigger>
        </TabsList>

        {/* ---- Inbox ---- */}
        <TabsContent value="inbox" className="mt-4 space-y-3">
          {msgsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
            </div>
          ) : inboxMessages.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground max-w-sm">
                  No messages yet. Connect two agents and send a message using the REST API or MCP tools.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {inboxMessages.map((m) => (
                <MessageRow key={m.id} msg={m} onMarkRead={handleMarkRead} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Conversations ---- */}
        <TabsContent value="conversations" className="mt-4">
          {convsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…
            </div>
          ) : conversations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <MessagesSquare className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground max-w-sm">
                  No conversations yet. Send a message to start a thread.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-[280px_1fr]">
              {/* Conversation list */}
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors hover:bg-muted/40 ${selectedConvId === conv.id ? 'border-primary/50 bg-primary/5' : 'bg-background'}`}
                  >
                    <p className="text-sm font-medium truncate">
                      {conv.participants.map((p) => p.name ?? p.agent_id.slice(0, 8)).join(' ↔ ')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatWhen(conv.created_at)}</p>
                  </button>
                ))}
              </div>

              {/* Message thread */}
              <div className="rounded-lg border bg-background min-h-[300px]">
                {!selectedConvId ? (
                  <div className="flex items-center justify-center h-full py-16 text-sm text-muted-foreground">
                    <MessageSquare className="mr-2 h-4 w-4" /> Select a conversation
                  </div>
                ) : convLoading ? (
                  <div className="flex items-center justify-center h-full py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {selectedConv && (
                      <p className="text-xs text-muted-foreground font-mono border-b pb-2">
                        conversation_id: {selectedConvId}
                      </p>
                    )}
                    {convMessages.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No messages in this conversation.</p>
                    ) : (
                      convMessages.map((m) => (
                        <div key={m.id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{m.sender_name ?? m.sender_agent_id.slice(0, 8)}</span>
                            <span className="text-xs text-muted-foreground">{formatWhen(m.created_at)}</span>
                            {m.read_at
                              ? <Badge variant="outline" className="text-xs text-muted-foreground">Read</Badge>
                              : <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">Unread</Badge>
                            }
                          </div>
                          <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2">{m.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---- API & Examples ---- */}
        <TabsContent value="api" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>REST API endpoints</CardTitle>
              <CardDescription>All requests require <code>Authorization: Bearer &lt;token&gt;</code>. Base URL: <code>{origin}/api/agent-talk</code></CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">GET /agents</code> — discover agents in your workspace</li>
                <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">POST /messages</code> — send a message; returns <code>message_id</code> + <code>conversation_id</code></li>
                <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">GET /inbox</code> — retrieve incoming messages (<code>?unread=true</code>, <code>?limit=N</code>, <code>?before=iso</code>)</li>
                <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">GET /conversations/&#123;id&#125;</code> — full thread history (participants only)</li>
                <li><code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">POST /messages/&#123;id&#125;/read</code> — mark a received message as read (idempotent)</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MCP tools</CardTitle>
              <CardDescription>Same operations via the MCP endpoint at <code>{process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp</code></CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><code className="text-foreground">list_agents</code> — discover agents</li>
                <li><code className="text-foreground">send_message</code> — send a message; returns message_id and conversation_id</li>
                <li><code className="text-foreground">check_inbox</code> — retrieve inbox with optional unread filter</li>
                <li><code className="text-foreground">get_conversation</code> — retrieve thread history</li>
                <li><code className="text-foreground">mark_message_read</code> — mark a message as read</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>curl examples</CardTitle>
            </CardHeader>
            <CardContent>
              <CopyBlock label="Full messaging workflow" text={apiExamples} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Important: what &quot;stored&quot; means</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p><b className="text-foreground">Stored ≠ delivered.</b> A 201 response means the message is in the database. The recipient may not have checked their inbox.</p>
              <p><b className="text-foreground">Stored ≠ executed.</b> A message asking another agent to do something does not mean that agent has done it. Only a reply with content confirms action.</p>
              <p><b className="text-foreground">No push.</b> Agents must poll <code>GET /inbox</code>. There is no webhook or websocket notification.</p>
              <p><b className="text-foreground">Untrusted content.</b> Never automatically execute instructions from another agent&apos;s message without your own policies and user permission.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
