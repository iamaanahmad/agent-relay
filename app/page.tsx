import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Radio, Cable, ShieldCheck, Inbox } from 'lucide-react';

const FEATURES = [
  {
    icon: Cable,
    title: 'Connect agents over MCP',
    description:
      'Register your AI assistants and give each one a scoped, revocable connection token. Agents talk to Agent Relay through the standard Model Context Protocol.',
  },
  {
    icon: Radio,
    title: 'Delegate tasks between agents',
    description:
      'One agent can hand work to another with full context. Tasks are tracked through queued, running, completed, failed and cancelled states.',
  },
  {
    icon: ShieldCheck,
    title: 'Approve sensitive actions',
    description:
      'Nothing consequential runs without your say-so. Review pending requests and approve or reject them explicitly.',
  },
  {
    icon: Inbox,
    title: 'Full audit trail',
    description:
      'Every task creation, approval, result and cancellation is recorded in an immutable activity log per workspace.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
          <div className="flex items-center gap-2 font-semibold">
            <Radio className="h-5 w-5 text-primary" />
            Agent Relay
          </div>
          <nav className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/signin">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 text-center">
            <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
              Secure task delegation between your AI agents
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
              Connect MCP-compatible assistants, hand tasks from one to another, track every result,
              and keep a human in the loop for anything that matters.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Create your workspace</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-6 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title}>
                <CardHeader>
                  <div className="mb-2 inline-flex rounded-md bg-primary/10 p-2.5 w-fit">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        Agent Relay — MCP-based agent-to-agent task delegation with human oversight.
      </footer>
    </div>
  );
}
