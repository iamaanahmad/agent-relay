'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { useWorkspace } from '@/components/workspace-provider';
import type { Agent, Task, TaskEvent, Workspace } from '@/lib/types';

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
