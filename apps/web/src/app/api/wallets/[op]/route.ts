import { circleClient, isOp, runOp, WalletsError, type CircleClient } from '@plug360/wallets';
import { ARC_TESTNET_ID } from '@plug360/shared';
import { network } from '@/lib/config';
import { createRateLimiter } from '@/lib/rateLimit';

// Server-only bridge to Circle's user-controlled wallets. The API key never reaches the browser, and no
// operation here can sign or send on its own: each one returns a challenge the user approves in Circle's UI.
export const runtime = 'nodejs';

const allow = createRateLimiter(60, 60_000);
const MAX_BODY = 32 * 1024;
let client: CircleClient | undefined;

const fail = (status: number, error: string, code?: number) => Response.json({ error, ...(code ? { code } : {}) }, { status });

export async function POST(req: Request, ctx: { params: Promise<{ op: string }> }) {
  const { op } = await ctx.params;
  if (!isOp(op)) return fail(404, 'unknown operation');
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) return fail(503, 'Sign-in with Google or email is not set up on this server');

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(ip)) return fail(429, 'Too many requests. Wait a minute and try again.');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return fail(413, 'request too large');

  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, 'request too large');
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail(400, 'body must be JSON');
  }

  try {
    client ??= circleClient(apiKey);
    const out = await runOp(client, op, body, req.headers.get('x-user-token') ?? undefined, {
      blockchain: network.chain.id === ARC_TESTNET_ID ? 'ARC-TESTNET' : 'ARC',
    });
    return Response.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof WalletsError) return fail(err.status, err.message, err.code);
    console.error('[wallets] unexpected error', err);
    return fail(500, 'Something went wrong talking to Circle');
  }
}
