import { buildLlmsTxt } from '@/lib/agent-skills';

export const dynamic = 'force-static';

// llms.txt discovery file so agents landing on the domain root can find the
// skill guide without being told its path.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  return new Response(buildLlmsTxt(origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
