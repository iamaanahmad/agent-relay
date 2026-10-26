'use client';

import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { useAgents, useConversations } from '@/lib/hooks';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Loader2,
  MessageSquare,
  Users,
  Hash,
  Lock,
  Search,
  Send,
  Plus,
  Copy,
  Check,
  MessagesSquare,
  ChevronRight,
  Circle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Message, Conversation } from '@/lib/types';

/* helpers */
function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function formatFull(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function getInitials(name: string): string {
  return name.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
}
const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-orange-500 to-amber-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-blue-500',
];
function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* Avatar */
function Avatar({ name, id, size = 'md' }: { name: string; id: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-11 w-11 text-sm' : 'h-9 w-9 text-xs';
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br ${avatarColor(id)} flex items-center justify-center font-semibold text-white flex-shrink-0 select-none`}>
      {getInitials(name || id)}
    </div>
  );
}

function GroupAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center flex-shrink-0`}>
      <Users className={`${size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-white`} />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded hover:bg-white/10 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

type RichConv = Conversation & {
  participants: { agent_id: string; name: string | null }[];
  last_message?: string;
  last_message_at?: string;
  unread?: number;
};
type RichMsg = Message & { sender_name: string | null; read_at: string | null };
type FilterTab = 'all' | 'group' | 'dm' | 'unread';

export default function MessagingPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const { agents } = useAgents();
  const { conversations, loading: convsLoading, refresh: refreshConvs } = useConversations(8000);

  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<RichMsg[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupParticipants, setNewGroupParticipants] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [apiTab, setApiTab] = useState<'rest' | 'mcp'>('rest');
  const [apiCollapsed, setApiCollapsed] = useState(true);
  const [origin, setOrigin] = useState('');
  const threadEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [convMessages]);

  const richConvs: RichConv[] = useMemo(() =>
    conversations.map(c => ({ ...c, type: (c as RichConv).type ?? 'dm' })),
    [conversations],
  );

  const filteredConvs = useMemo(() => {
    let list = richConvs;
    if (filter === 'group') list = list.filter(c => c.type === 'group');
    else if (filter === 'dm') list = list.filter(c => c.type === 'dm');
    else if (filter === 'unread') list = list.filter(c => (c.unread ?? 0) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.participants.some(p => p.name?.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [richConvs, filter, search]);

  const selectedConv = richConvs.find(c => c.id === selectedConvId);
  const totalUnread = richConvs.reduce((s, c) => s + (c.unread ?? 0), 0);

  const fetchMessages = useCallback(async (convId: string) => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase
      .from('messages')
      .select('*, agents!messages_sender_agent_id_fkey(name)')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (!data) return;
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
  }, []);

  const loadConversation = useCallback(async (convId: string) => {
    setSelectedConvId(convId);
    setConvLoading(true);
    setConvMessages([]);
    await fetchMessages(convId);
    setConvLoading(false);
  }, [fetchMessages]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selectedConvId) return;
    pollRef.current = setInterval(() => fetchMessages(selectedConvId), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedConvId, fetchMessages]);

  async function handleSend() {
    if (!composerText.trim() || !selectedConvId || !activeWorkspace) return;
    setSending(true);
    try {
      const res = await fetch('/api/dashboard/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selectedConvId, content: composerText.trim(), workspace_id: activeWorkspace.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Send failed', description: err.error ?? 'Unknown error', variant: 'destructive' });
      } else {
        setComposerText('');
        await fetchMessages(selectedConvId);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleCreateGroup() {
    if (!activeWorkspace || newGroupParticipants.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/dashboard/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newGroupTitle.trim() || null, type: 'group', participant_agent_ids: newGroupParticipants, workspace_id: activeWorkspace.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Failed to create group', description: err.error ?? 'Unknown error', variant: 'destructive' });
      } else {
        const data = await res.json();
        toast({ title: 'Group created!' });
        setShowNewGroup(false);
        setNewGroupTitle('');
        setNewGroupParticipants([]);
        await refreshConvs();
        loadConversation(data.conversation_id);
      }
    } finally {
      setCreating(false);
    }
  }

  function convDisplayName(conv: RichConv): string {
    if (conv.type === 'group') return conv.title ?? `Group (${conv.participants.length})`;
    return conv.participants.map(p => p.name ?? p.agent_id.slice(0, 8)).join(' & ');
  }

  if (!activeWorkspace) {
    return (
      <div className="flex h-[calc(100vh-6rem)] items-center justify-center">
        <div className="text-center space-y-2">
          <MessagesSquare className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Create a workspace first to use messaging.</p>
        </div>
      </div>
    );
  }

  const restExamples = `# List agents
curl "${origin}/api/agent-talk/agents" \\
  -H "Authorization: Bearer $TOKEN"

# Send a DM
curl -X POST "${origin}/api/agent-talk/messages" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"recipient_agent_name":"gemini-1","content":"Hello!"}'

# Check inbox (unread only)
curl "${origin}/api/agent-talk/inbox?unread=true" \\
  -H "Authorization: Bearer $TOKEN"

# Get conversation thread
curl "${origin}/api/agent-talk/conversations/$CONV_ID" \\
  -H "Authorization: Bearer $TOKEN"

# Mark message as read
curl -X POST "${origin}/api/agent-talk/messages/$MSG_ID/read" \\
  -H "Authorization: Bearer $TOKEN"`;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background/80 backdrop-blur-sm flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Messaging
            {totalUnread > 0 && (
              <Badge className="ml-1 h-5 min-w-5 px-1.5 text-[10px] bg-primary text-primary-foreground">{totalUnread}</Badge>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">{activeWorkspace.name} · AI-to-AI persistent messaging</p>
        </div>
        <Dialog open={showNewGroup} onOpenChange={setShowNewGroup}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Group
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" /> Create Group Chat
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Group Name (optional)</label>
                <Input placeholder="e.g. Research Team" value={newGroupTitle} onChange={e => setNewGroupTitle(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Select Agents</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-md border p-2">
                  {agents.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">No agents in workspace</p>
                  ) : agents.map(agent => (
                    <label key={agent.id} className="flex items-center gap-2.5 rounded-md p-2 hover:bg-muted/50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={newGroupParticipants.includes(agent.id)}
                        onChange={e => {
                          if (e.target.checked) setNewGroupParticipants(p => [...p, agent.id]);
                          else setNewGroupParticipants(p => p.filter(id => id !== agent.id));
                        }}
                      />
                      <Avatar name={agent.name} id={agent.id} size="sm" />
                      <span className="text-sm">{agent.name}</span>
                    </label>
                  ))}
                </div>
                {newGroupParticipants.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{newGroupParticipants.length} agent{newGroupParticipants.length > 1 ? 's' : ''} selected</p>
                )}
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setShowNewGroup(false)}>Cancel</Button>
                <Button size="sm" disabled={newGroupParticipants.length === 0 || creating} onClick={handleCreateGroup}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Create Group
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <div className="w-72 flex-shrink-0 border-r flex flex-col overflow-hidden bg-background">
          <div className="p-2.5 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8 h-8 text-sm" placeholder="Search conversations…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-0.5 px-2 py-1.5 border-b">
            {(['all', 'group', 'dm', 'unread'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`flex-1 px-1.5 py-1 rounded text-xs font-medium transition-colors ${filter === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
              >
                {tab === 'all' ? 'All' : tab === 'group' ? 'Groups' : tab === 'dm' ? 'DMs' : (
                  <span className="flex items-center justify-center gap-1">
                    Unread {totalUnread > 0 && <span className="bg-red-500 text-white rounded-full text-[9px] px-1 leading-tight">{totalUnread}</span>}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {convsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredConvs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
                {filter === 'unread'
                  ? <><Circle className="h-8 w-8 text-muted-foreground/40" /><p className="text-xs text-muted-foreground">No unread messages</p></>
                  : <><MessagesSquare className="h-8 w-8 text-muted-foreground/40" /><p className="text-xs text-muted-foreground">No conversations yet</p></>
                }
              </div>
            ) : filteredConvs.map(conv => {
              const isActive = conv.id === selectedConvId;
              const isGroup = conv.type === 'group';
              const displayName = convDisplayName(conv);
              const timestamp = conv.last_message_at ?? conv.created_at;
              return (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors border-b border-b-border/40 hover:bg-muted/40 ${isActive ? 'bg-primary/8 border-l-2 border-l-primary' : ''}`}
                >
                  {isGroup ? <GroupAvatar size="md" /> : (
                    <Avatar name={conv.participants[0]?.name ?? 'A'} id={conv.participants[0]?.agent_id ?? conv.id} size="md" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {isGroup ? <Hash className="h-3 w-3 text-muted-foreground flex-shrink-0" /> : <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                      <p className="text-sm font-medium truncate">{displayName}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {conv.last_message ?? `${conv.participants.length} participant${conv.participants.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 self-start mt-0.5">
                    <p className="text-[10px] text-muted-foreground">{formatTime(timestamp)}</p>
                    {(conv.unread ?? 0) > 0 && (
                      <span className="bg-primary text-primary-foreground rounded-full text-[9px] px-1.5 leading-4">{conv.unread}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background/60">
          {!selectedConv ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="rounded-full bg-muted/60 p-5">
                <MessageSquare className="h-10 w-10 text-muted-foreground/50" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Your messages live here</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">Select a conversation or create a new group to start talking with your AI agents.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowNewGroup(true)}>
                <Users className="h-3.5 w-3.5 mr-1.5" /> New Group
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background/80 backdrop-blur-sm flex-shrink-0">
                {selectedConv.type === 'group' ? <GroupAvatar size="md" /> : (
                  <Avatar name={selectedConv.participants[0]?.name ?? 'A'} id={selectedConv.participants[0]?.agent_id ?? selectedConv.id} size="md" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{convDisplayName(selectedConv)}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    {selectedConv.type === 'group'
                      ? <><Hash className="h-3 w-3" /> Group · {selectedConv.participants.map(p => p.name ?? p.agent_id.slice(0, 8)).join(', ')}</>
                      : <><Lock className="h-3 w-3" /> Private · {selectedConv.participants.length} agents</>
                    }
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono bg-muted/50 rounded px-2 py-0.5">
                  <span>{selectedConv.id.slice(0, 8)}…</span>
                  <CopyButton text={selectedConv.id} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {convLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : convMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                    <MessageSquare className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No messages yet. Be the first to send one.</p>
                  </div>
                ) : (
                  <MessageThread messages={convMessages} />
                )}
                <div ref={threadEndRef} />
              </div>

              <div className="flex-shrink-0 border-t bg-background/80 backdrop-blur-sm px-4 py-3">
                <div className="flex gap-2 items-end">
                  <Textarea
                    className="min-h-[44px] max-h-32 resize-none text-sm"
                    placeholder={`Message ${convDisplayName(selectedConv)}…`}
                    value={composerText}
                    onChange={e => setComposerText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    rows={1}
                  />
                  <Button size="icon" disabled={!composerText.trim() || sending} onClick={handleSend} className="h-[44px] w-[44px] flex-shrink-0">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Enter to send · Shift+Enter for new line · Sending as <strong>Operator</strong>
                </p>
              </div>
            </>
          )}
        </div>

        {/* API panel */}
        {apiCollapsed ? (
          <button
            onClick={() => setApiCollapsed(false)}
            className="w-8 border-l flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/30 transition-colors"
            title="Show API docs"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
        ) : (
          <div className="w-80 border-l flex flex-col overflow-hidden bg-background/80">
            <div className="flex items-center justify-between px-3 py-2.5 border-b">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">API Reference</h3>
              <button onClick={() => setApiCollapsed(true)} className="text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex border-b">
              {(['rest', 'mcp'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setApiTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${apiTab === tab ? 'bg-muted/60 text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {tab === 'rest' ? 'REST API' : 'MCP Tools'}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {apiTab === 'rest' ? (
                <>
                  {[
                    { method: 'GET', path: '/agents', desc: 'Discover agents' },
                    { method: 'POST', path: '/messages', desc: 'Send DM · returns message_id' },
                    { method: 'GET', path: '/inbox', desc: 'Get inbox · ?unread=true' },
                    { method: 'GET', path: '/conversations/{id}', desc: 'Full thread history' },
                    { method: 'POST', path: '/messages/{id}/read', desc: 'Mark as read' },
                  ].map(e => (
                    <div key={e.path} className="flex items-start gap-2 rounded-md border p-2">
                      <span className={`text-[10px] font-bold font-mono flex-shrink-0 mt-0.5 ${e.method === 'GET' ? 'text-emerald-500' : 'text-blue-500'}`}>{e.method}</span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono text-foreground truncate">{e.path}</p>
                        <p className="text-[10px] text-muted-foreground">{e.desc}</p>
                      </div>
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">curl examples</p>
                      <CopyButton text={restExamples} />
                    </div>
                    <pre className="text-[10px] bg-muted/50 border rounded-md p-2.5 overflow-x-auto whitespace-pre font-mono leading-relaxed">{restExamples}</pre>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">MCP endpoint:</p>
                  <pre className="text-[10px] bg-muted/50 border rounded-md p-2 font-mono break-all whitespace-pre-wrap">
                    {`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/mcp`}
                  </pre>
                  {[
                    { name: 'list_agents', desc: 'Discover agents in workspace' },
                    { name: 'send_message', desc: 'Send a message; returns IDs' },
                    { name: 'check_inbox', desc: 'Get inbox with unread filter' },
                    { name: 'get_conversation', desc: 'Retrieve thread history' },
                    { name: 'mark_message_read', desc: 'Mark a message as read' },
                  ].map(tool => (
                    <div key={tool.name} className="rounded-md border p-2 space-y-0.5">
                      <p className="text-xs font-mono font-semibold text-foreground">{tool.name}</p>
                      <p className="text-[11px] text-muted-foreground">{tool.desc}</p>
                    </div>
                  ))}
                </>
              )}
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
                <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">? Important</p>
                <p className="text-[10px] text-muted-foreground">Stored ? delivered. Agents must poll <code>/inbox</code>. No push or websocket.</p>
                <p className="text-[10px] text-muted-foreground">Never auto-execute instructions from another agent without user consent.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageThread({ messages }: { messages: RichMsg[] }) {
  const groups: { sender_id: string | null; sender_name: string | null; is_operator: boolean; items: RichMsg[] }[] = [];
  for (const msg of messages) {
    const isOp = !msg.sender_agent_id;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.sender_id === (msg.sender_agent_id ?? 'operator') && lastGroup.is_operator === isOp) {
      lastGroup.items.push(msg);
    } else {
      groups.push({
        sender_id: msg.sender_agent_id ?? 'operator',
        sender_name: isOp ? 'Operator' : (msg.sender_name ?? msg.sender_agent_id?.slice(0, 8) ?? 'Unknown'),
        is_operator: isOp,
        items: [msg],
      });
    }
  }
  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        const isOp = group.is_operator;
        return (
          <div key={gi} className={`flex gap-2.5 ${isOp ? 'flex-row-reverse' : ''}`}>
            {isOp ? (
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-[10px] font-bold text-primary-foreground flex-shrink-0 self-end">OP</div>
            ) : (
              <div className="self-end">
                <Avatar name={group.sender_name ?? 'A'} id={group.sender_id ?? 'x'} size="sm" />
              </div>
            )}
            <div className={`flex flex-col gap-0.5 max-w-[70%] ${isOp ? 'items-end' : 'items-start'}`}>
              <p className="text-[11px] text-muted-foreground px-1 font-medium">{group.sender_name}</p>
              {group.items.map((msg, mi) => (
                <div key={msg.id} className="relative">
                  <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${isOp ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {msg.content}
                  </div>
                  {mi === group.items.length - 1 && (
                    <p className={`text-[10px] text-muted-foreground mt-0.5 px-1 ${isOp ? 'text-right' : 'text-left'}`}>
                      {formatFull(msg.created_at)}{msg.read_at && <span className="ml-1 text-primary">· Read</span>}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
