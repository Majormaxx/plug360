/**
 * GET /api/reputation/stats          → PlugStats[] (all plugs)
 * GET /api/reputation/stats?plug=0x  → PlugStats   (single plug)
 *
 * This endpoint aggregates Tier 1 stats from the keeper's state file (server-side)
 * or falls through to an empty list when the keeper is not running.
 *
 * The keeper writes its state to KEEPER_STATE_FILE. This route reads that file
 * directly when running on the same host as the keeper, avoiding an extra HTTP hop.
 * Set KEEPER_STATS_URL to proxy to a remote keeper instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAddress, type Address } from 'viem';
import type { PlugStats } from '@plug360/shared';

export const runtime = 'nodejs';

const KEEPER_STATE_FILE = process.env.KEEPER_STATE_FILE;
const KEEPER_STATS_URL = process.env.KEEPER_STATS_URL;

type KeeperState = {
  plugStats?: Record<string, PlugStats>;
};

function loadFromFile(): PlugStats[] {
  if (!KEEPER_STATE_FILE || !existsSync(KEEPER_STATE_FILE)) return [];
  try {
    const state = JSON.parse(readFileSync(KEEPER_STATE_FILE, 'utf8')) as KeeperState;
    return Object.values(state.plugStats ?? {});
  } catch {
    return [];
  }
}

async function loadFromUrl(): Promise<PlugStats[]> {
  if (!KEEPER_STATS_URL) return [];
  try {
    const res = await fetch(KEEPER_STATS_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    return (await res.json()) as PlugStats[];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const stats = KEEPER_STATE_FILE ? loadFromFile() : await loadFromUrl();

  const { searchParams } = new URL(req.url);
  const plug = searchParams.get('plug');
  if (plug) {
    if (!isAddress(plug)) return Response.json({ error: 'invalid address' }, { status: 400 });
    const found = stats.find((s) => s.address.toLowerCase() === (plug as Address).toLowerCase());
    if (!found) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json(found);
  }

  return Response.json(stats);
}
