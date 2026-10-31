/**
 * GET  /api/reputation/reviews?plug=0x...  → Review[]
 * POST /api/reputation/reviews              → Review (body: ReviewInput)
 *
 * The POST gate: verifies the buyer's EIP-191 signature over reviewPayload(), then
 * checks on-chain that getDeal(dealId).buyer == signer and .plug == plugAddress,
 * and that the deal is in a final state (Refunded or Settled).
 */
import { getAddress, verifyMessage, createPublicClient, http, isAddress } from 'viem';
import { dealEscrowAbi, DealStatus, reviewPayload } from '@plug360/shared';
import type { ReviewInput } from '@plug360/shared';
import { network } from '@/lib/config';
import { createRateLimiter } from '@/lib/rateLimit';
import { insertReview, getReviewsForPlug } from '@/lib/reputation/db';

export const runtime = 'nodejs';

const allow = createRateLimiter(10, 60_000);
const MAX_TEXT = 280;

const client = createPublicClient({ chain: network.chain, transport: http(network.rpcUrls[0]) });

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const plug = searchParams.get('plug');
  if (!plug || !isAddress(plug)) return fail(400, 'plug address required');
  const reviews = getReviewsForPlug(plug);
  return Response.json(reviews);
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(ip)) return fail(429, 'Too many requests. Wait a minute.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'body must be JSON');
  }

  const input = body as Partial<ReviewInput>;
  const { dealId, plugAddress, buyerAddress, rating, text, wasDisputed, signature } = input;

  if (!dealId || typeof dealId !== 'string') return fail(400, 'dealId required');
  if (!plugAddress || !isAddress(plugAddress)) return fail(400, 'plugAddress required');
  if (!buyerAddress || !isAddress(buyerAddress)) return fail(400, 'buyerAddress required');
  if (!rating || rating < 1 || rating > 5) return fail(400, 'rating must be 1-5');
  if (!text || typeof text !== 'string' || text.trim().length === 0) return fail(400, 'text required');
  if (text.length > MAX_TEXT) return fail(400, `text max ${MAX_TEXT} chars`);
  if (typeof wasDisputed !== 'boolean') return fail(400, 'wasDisputed required');
  if (!signature || typeof signature !== 'string') return fail(400, 'signature required');

  // Verify EIP-191 signature.
  const payload = reviewPayload({ dealId, plugAddress: getAddress(plugAddress), buyerAddress: getAddress(buyerAddress), rating, text, wasDisputed });
  try {
    const valid = await verifyMessage({ address: getAddress(buyerAddress), message: payload, signature: signature as `0x${string}` });
    if (!valid) return fail(401, 'signature does not match');
  } catch {
    return fail(401, 'invalid signature');
  }

  // Check on-chain: deal exists, buyer matches, plug matches, deal is final.
  try {
    const deal = await client.readContract({
      address: network.escrow,
      abi: dealEscrowAbi,
      functionName: 'getDeal',
      args: [BigInt(dealId)],
    }) as { buyer: string; plug: string; status: number };

    if (deal.status === DealStatus.None) return fail(404, 'deal not found');
    if (deal.buyer.toLowerCase() !== buyerAddress.toLowerCase()) return fail(403, 'not the buyer of this deal');
    if (deal.plug.toLowerCase() !== plugAddress.toLowerCase()) return fail(403, 'plug address does not match deal');
    if (deal.status !== DealStatus.Refunded && deal.status !== DealStatus.Settled) {
      return fail(422, 'deal must be final (Refunded or Settled)');
    }
  } catch (err) {
    console.error('[reviews] on-chain check failed', err);
    return fail(502, 'could not verify deal on-chain');
  }

  try {
    const review = await insertReview({
      dealId,
      plugAddress: getAddress(plugAddress),
      buyerAddress: getAddress(buyerAddress),
      rating: rating as 1 | 2 | 3 | 4 | 5,
      text: text.trim(),
      wasDisputed,
      signature,
    });
    return Response.json(review, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'already-reviewed') return fail(409, 'you already reviewed this deal');
    console.error('[reviews] insert failed', err);
    return fail(500, 'could not save review');
  }
}
