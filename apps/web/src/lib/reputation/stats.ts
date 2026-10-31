/**
 * Tier 1 — on-chain stats for a plug, fetched from the keeper's stats endpoint or
 * computed client-side from the deals scan cache when no keeper is configured.
 *
 * The keeper endpoint (NEXT_PUBLIC_KEEPER_STATS_URL) returns PlugStats[] as JSON.
 * Fallback: derive a limited stat set from the local scan cache stored by the app.
 */
import type { PlugStats } from '@plug360/shared';
import type { Address } from 'viem';

const KEEPER_STATS_URL = process.env.NEXT_PUBLIC_KEEPER_STATS_URL;

let _statsCache: PlugStats[] | null = null;
let _statsCachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function fetchAllPlugStats(): Promise<PlugStats[]> {
  if (!KEEPER_STATS_URL) return [];
  const now = Date.now();
  if (_statsCache && now - _statsCachedAt < CACHE_TTL_MS) return _statsCache;

  try {
    const res = await fetch(KEEPER_STATS_URL, { next: { revalidate: 60 } });
    if (!res.ok) return _statsCache ?? [];
    const data = (await res.json()) as PlugStats[];
    _statsCache = data;
    _statsCachedAt = now;
    return data;
  } catch {
    return _statsCache ?? [];
  }
}

export async function fetchPlugStats(address: Address): Promise<PlugStats | null> {
  const all = await fetchAllPlugStats();
  return all.find((s) => s.address.toLowerCase() === address.toLowerCase()) ?? null;
}

/**
 * Computes a rough PlugStats from a flat list of deal events (client-side fallback).
 * Deals must include at minimum: plug address, status, paidAt, disputedAt, plugRuledAt, forBuyer, price.
 */
export function computeStatsFromDeals(
  plugAddress: string,
  deals: Array<{
    plug: string;
    status: number;
    paidAt: number;
    disputedAt?: number;
    plugRuledAt?: number;
    forBuyer?: boolean;
    price: bigint;
  }>,
): PlugStats {
  const addr = plugAddress.toLowerCase();
  const mine = deals.filter((d) => d.plug.toLowerCase() === addr);
  const now = Math.floor(Date.now() / 1000);
  const cutoff90 = now - 90 * 24 * 60 * 60;

  const disputed = mine.filter((d) => d.disputedAt !== undefined && d.disputedAt > 0);
  const ruled = disputed.filter((d) => d.plugRuledAt !== undefined && d.plugRuledAt > 0);
  const forBuyer = ruled.filter((d) => d.forBuyer === true).length;
  const forSeller = ruled.filter((d) => d.forBuyer === false).length;
  const timedOut = disputed.length - ruled.length;

  const rulingTimes = ruled
    .map((d) => ((d.plugRuledAt! - d.disputedAt!) / 3600))
    .sort((a, b) => a - b);
  const medianRulingHours =
    rulingTimes.length > 0
      ? rulingTimes[Math.floor(rulingTimes.length / 2)]!
      : null;

  const totalUsdcRefereed = mine.reduce((acc, d) => acc + d.price, 0n).toString();
  const firstDeal = mine.reduce<number | null>((acc, d) => (acc === null || d.paidAt < acc ? d.paidAt : acc), null);

  return {
    address: plugAddress as Address,
    totalDeals: mine.length,
    recentDeals: mine.filter((d) => d.paidAt >= cutoff90).length,
    totalUsdcRefereed,
    totalDisputes: disputed.length,
    ruledForBuyer: forBuyer,
    ruledForSeller: forSeller,
    timedOut,
    medianRulingHours: medianRulingHours !== undefined ? medianRulingHours : null,
    firstDealAt: firstDeal,
    computedAt: now,
  };
}
