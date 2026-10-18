'use client';

import { useState } from 'react';
import { useAgents } from '@/lib/hooks';
import { useWorkspace } from '@/components/workspace-provider';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Send, Loader2 } from 'lucide-react';

export default function SendTaskPage() {
  const { activeWorkspace } = useWorkspace();
  const { agents, loading } = useAgents();
  const { toast } = useToast();

  const [recipient, setRecipient] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient || !title.trim() || !instructions.trim() || !activeWorkspace) return;
    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('tasks').insert({
      workspace_id: activeWorkspace.id,
      sender_agent_id: null,
      recipient_agent_id: recipient,
      title: title.trim(),
      instructions: instructions.trim(),
      status: requiresApproval ? 'awaiting_approval' : 'queued',
      requires_approval: requiresApproval,
    });
    setBusy(false);
    if (error) {
      toast({ title: 'Could not send task', description: error.message, variant: 'destructive' });
      return;
    }
    setTitle('');
    setInstructions('');
    setRequiresApproval(false);
    setRecipient('');
    toast({ title: 'Task sent', description: 'It is now in the receiving agent\'s queue.' });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Send a task</h1>
        <p className="text-sm text-muted-foreground">
          Delegate work directly to one of your connected agents.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New task</CardTitle>
          <CardDescription>The agent will pick this up from its queue via MCP.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Recipient agent</Label>
              <Select value={recipient} onValueChange={setRecipient} required>
                <SelectTrigger>
                  <SelectValue placeholder={loading ? 'Loading agents…' : 'Choose an agent'} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Summarise this week's research notes"
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-instructions">Instructions</Label>
              <Textarea
                id="task-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="What exactly should the agent do? Include any relevant context."
                rows={6}
                required
                maxLength={10000}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="task-approval"
                checked={requiresApproval}
                onCheckedChange={(v) => setRequiresApproval(v === true)}
              />
              <Label htmlFor="task-approval" className="text-sm font-normal">
                Require my approval before this task runs
              </Label>
            </div>
            <Button type="submit" disabled={busy || !recipient || agents.length === 0}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send task
            </Button>
            {agents.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">
                Add an agent first — there is nothing to send work to yet.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
