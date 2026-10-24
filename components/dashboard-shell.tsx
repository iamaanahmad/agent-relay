'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Radio, LayoutDashboard, Plug, Send, Inbox, ShieldCheck, ScrollText, MessageSquareText, BookOpen, Loader2, ChevronsUpDown, Plus, Check, LogOut } from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Plug },
  { href: '/send', label: 'Send task', icon: Send },
  { href: '/agent-talk', label: 'Messaging', icon: MessageSquareText },
  { href: '/skills', label: 'Agent Skills', icon: BookOpen },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/activity', label: 'Activity', icon: ScrollText },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { workspaces, activeWorkspace, loading: wsLoading, createWorkspace, setActiveWorkspaceId } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/signin');
    }
  }, [authLoading, user, router]);

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const created = await createWorkspace(newName.trim());
    setCreating(false);
    if (created) {
      setNewName('');
      setDialogOpen(false);
      toast({ title: 'Workspace created', description: `${created.name} is now active.` });
    } else {
      toast({
        title: 'Could not create workspace',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    }
  }

  if (authLoading || (wsLoading && user)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  // First-run onboarding: a user with no workspaces must create one first.
  if (workspaces.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-center gap-2 text-2xl font-semibold">
            <Radio className="h-7 w-7 text-primary" />
            <span>Agent Relay</span>
          </div>
          <div className="rounded-lg border bg-background p-6 shadow-sm">
            <h1 className="text-lg font-semibold">Welcome! Create your first workspace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A workspace keeps your agents, tasks and approvals isolated per project. You need one
              before you can connect agents or delegate tasks.
            </p>
            <form onSubmit={handleCreateWorkspace} className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ws-onboard-name">Workspace name</Label>
                <Input
                  id="ws-onboard-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Research project"
                  required
                  maxLength={80}
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={creating || !newName.trim()}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create workspace
              </Button>
            </form>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Signed in as {user.email} ·{' '}
            <button onClick={signOut} className="underline hover:text-foreground">
              Sign out
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <Radio className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">Agent Relay</span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 max-w-[180px]">
                <span className="truncate">{activeWorkspace?.name ?? 'No workspace'}</span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} onClick={() => setActiveWorkspaceId(w.id)} className="gap-2">
                  <Check className={`h-4 w-4 ${w.id === activeWorkspace?.id ? '' : 'opacity-0'}`} />
                  <span className="truncate">{w.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setDialogOpen(true);
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> New workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                  pathname === href
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            ))}
          </nav>

          <Button variant="ghost" size="icon" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreateWorkspace}>
            <DialogHeader>
              <DialogTitle>Create workspace</DialogTitle>
              <DialogDescription>
                Workspaces isolate agents, tasks and conversations per project.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-2">
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input
                id="ws-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Research project"
                required
                maxLength={80}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
