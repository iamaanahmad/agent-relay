import { buildLlmsTxt } from '@/lib/agent-skills';

export const dynamic = 'force-dynamic';

// llms.txt discovery file so agents landing on the domain root can find the
// skill guide without being told its path.
export async function GET(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;
  return new Response(buildLlmsTxt(origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
