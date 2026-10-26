'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { useWorkspace } from '@/components/workspace-provider';
import type { Agent, Task, TaskEvent, Workspace, Message, Conversation } from '@/lib/types';

export function useAgents() {
  const { activeWorkspace } = useWorkspace();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeWorkspace) {
      setAgents([]);
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('workspace_id', activeWorkspace.id)
      .order('created_at', { ascending: true });
    if (!error) setAgents(data ?? []);
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}

export function useTasks(pollMs?: number) {
  const { activeWorkspace } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeWorkspace) {
      setTasks([]);
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', activeWorkspace.id)
      .order('created_at', { ascending: false });
    if (!error) setTasks(data ?? []);
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (!pollMs) return;
    const interval = setInterval(refresh, pollMs);
    return () => clearInterval(interval);
  }, [refresh, pollMs]);

  return { tasks, loading, refresh };
}

export function useTaskEvents() {
  const { activeWorkspace } = useWorkspace();
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeWorkspace) {
      setEvents([]);
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('task_events')
      .select('*')
      .eq('workspace_id', activeWorkspace.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) setEvents(data ?? []);
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { events, loading, refresh };
}

export function useWorkspacesRaw(): Workspace[] {
  const { workspaces } = useWorkspace();
  return workspaces;
}

export function useMessages(pollMs?: number) {
  const { activeWorkspace } = useWorkspace();
  const [messages, setMessages] = useState<(Message & { sender_name: string | null; read_at: string | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!activeWorkspace) {
      setMessages([]);
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    // Fetch all messages in this workspace for the dashboard view
    const { data, error } = await supabase
      .from('messages')
      .select('*, agents!messages_sender_agent_id_fkey(name)')
      .eq('workspace_id', activeWorkspace.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error && data) {
      // Fetch all read receipts for this workspace
      const msgIds = data.map((m: { id: string }) => m.id);
      const { data: reads } = msgIds.length > 0
        ? await supabase.from('message_reads').select('message_id, read_at').in('message_id', msgIds)
        : { data: [] };
      const readMap = new Map((reads ?? []).map((r: { message_id: string; read_at: string }) => [r.message_id, r.read_at]));
      const enriched = data.map((m: Message & { agents: { name: string } | null }) => ({
        ...m,
        sender_name: m.agents?.name ?? null,
        read_at: readMap.get(m.id) ?? null,
      }));
      setMessages(enriched);
      setUnreadCount(enriched.filter((m) => !m.read_at).length);
    }
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (!pollMs) return;
    const interval = setInterval(refresh, pollMs);
    return () => clearInterval(interval);
  }, [refresh, pollMs]);

  return { messages, loading, unreadCount, refresh };
}

export function useConversations(pollMs?: number) {
  const { activeWorkspace } = useWorkspace();
  const [conversations, setConversations] = useState<(Conversation & { participants: { agent_id: string; name: string | null }[] })[]
  >([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeWorkspace) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('conversations')
      .select('*, conversation_participants(agent_id, agents(name))')
      .eq('workspace_id', activeWorkspace.id)
      .order('created_at', { ascending: false });
    if (!error && data) {
      setConversations(
        data.map((c: Conversation & { conversation_participants: { agent_id: string; agents: { name: string } | null }[] }) => ({
          ...c,
          participants: (c.conversation_participants ?? []).map((p) => ({
            agent_id: p.agent_id,
            name: p.agents?.name ?? null,
          })),
        }))
      );
    }
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (!pollMs) return;
    const interval = setInterval(refresh, pollMs);
    return () => clearInterval(interval);
  }, [refresh, pollMs]);

  return { conversations, loading, refresh };
}
