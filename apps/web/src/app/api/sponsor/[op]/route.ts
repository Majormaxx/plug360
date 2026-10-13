import { isOp, sponsorFromKey, SponsorError } from '@plug360/sponsor';
import { network } from '@/lib/config';
import { createRateLimiter } from '@/lib/rateLimit';

// The gas sponsor's server side. It pays from a hot wallet that only holds gas money, and every request is
// checked against chain state before anything is spent (see services/sponsor).
export const runtime = 'nodejs';

const allow = createRateLimiter(20, 60_000);
const MAX_BODY = 32 * 1024;
let sponsor: ReturnType<typeof sponsorFromKey> | undefined;

const fail = (status: number, error: string, reason?: string) => Response.json({ error, ...(reason ? { reason } : {}) }, { status });

export async function POST(req: Request, ctx: { params: Promise<{ op: string }> }) {
  const { op } = await ctx.params;
  if (!isOp(op)) return fail(404, 'unknown operation');
  const key = process.env.SPONSOR_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return fail(503, 'Gas sponsorship is not set up on this server', 'unconfigured');

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(ip)) return fail(429, 'Too many requests. Wait a minute and try again.');
  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, 'request too large');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail(400, 'body must be JSON');
  }

  try {
    sponsor ??= sponsorFromKey({
      privateKey: key as `0x${string}`,
      chain: network.chain,
      rpcUrls: network.rpcUrls,
      escrow: network.escrow,
      ...(process.env.SPONSOR_MAX_TOPUP_USDC ? { maxTopUp: process.env.SPONSOR_MAX_TOPUP_USDC } : {}),
    });
    return Response.json(await sponsor.run(op, body), { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof SponsorError) return fail(err.status, err.message, err.reason);
    console.error('[sponsor] unexpected error', err);
    return fail(502, 'The gas sponsor could not complete this right now', 'sponsor-failed');
  }
}
