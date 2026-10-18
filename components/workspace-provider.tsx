'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { Workspace } from '@/lib/types';
import { useAuth } from '@/components/auth-provider';

type WorkspaceContextValue = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  loading: boolean;
  createWorkspace: (name: string) => Promise<Workspace | null>;
  setActiveWorkspaceId: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspace: null,
  loading: true,
  createWorkspace: async () => null,
  setActiveWorkspaceId: () => {},
});

const STORAGE_KEY = 'agent-relay-active-workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    supabase
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoading(false);
          return;
        }
        const list = data ?? [];
        setWorkspaces(list);
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
        const valid = list.find((w) => w.id === stored) ?? list[0] ?? null;
        setActiveId(valid?.id ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const createWorkspace = useCallback(async (name: string) => {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('workspaces')
      .insert({ name })
      .select()
      .maybeSingle();
    if (error || !data) return null;
    setWorkspaces((prev) => [...prev, data]);
    setActiveId(data.id);
    return data;
  }, []);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
    router.refresh();
  }, []);

  const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, activeWorkspace, loading, createWorkspace, setActiveWorkspaceId }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
