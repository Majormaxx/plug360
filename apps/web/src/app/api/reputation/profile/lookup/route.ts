/**
 * GET /api/reputation/profile/lookup?plug=<address>
 *
 * Returns { cid: string } when a profile CID is registered for the plug
 * (either from the CID store written by /publish, or from the keeper stats
 * API which reflects onchain PlugLevelSet events).
 *
 * Returns 404 when no CID is known.
 */
import { getAddress } from 'viem';
import { getCid } from '@/lib/reputation/cid-store';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('plug') ?? '';

  let address: string;
  try {
    address = getAddress(raw);
  } catch {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }

  // 1. Check the local CID store (populated by /publish).
  const stored = await getCid(address);
  if (stored) return Response.json({ cid: stored });

  // 2. If a keeper stats URL is configured, ask it (keeper reads CIDs from
  //    onchain PlugLevelSet events, which is the trustless source once the
  //    contract emits them).
  const keeperUrl = process.env.NEXT_PUBLIC_KEEPER_STATS_URL ?? process.env.KEEPER_STATS_URL;
  if (keeperUrl) {
    try {
      const res = await fetch(`${keeperUrl}/stats/plugs/${address}`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok) {
        const data = await res.json() as { profileCid?: string };
        if (data.profileCid) {
          return Response.json({ cid: data.profileCid });
        }
      }
    } catch {
      // keeper unreachable — fall through to 404
    }
  }

  return Response.json({ error: 'no profile CID registered' }, { status: 404 });
}
