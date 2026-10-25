import { buildSkillsMarkdown } from '@/lib/agent-skills';

export const dynamic = 'force-dynamic';

// Machine-readable Agent Skills guide. LLMs and coding agents parse this far
// more reliably than HTML. Stable URL, no tokens, no user data.
export async function GET(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;
  const markdown = buildSkillsMarkdown(origin);
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
