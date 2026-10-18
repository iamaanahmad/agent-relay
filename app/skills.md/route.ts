import { buildSkillsMarkdown } from '@/lib/agent-skills';

export const dynamic = 'force-static';

// Machine-readable Agent Skills guide. LLMs and coding agents parse this far
// more reliably than HTML. Stable URL, no tokens, no user data.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const markdown = buildSkillsMarkdown(origin);
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
