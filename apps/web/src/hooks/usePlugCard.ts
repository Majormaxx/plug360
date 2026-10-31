'use client';

/**
 * Loads all three tiers of reputation data for a single plug address.
 * Returns a PlugCard merged from on-chain reads, stats API, reviews API, and IPFS profile.
 */
import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { getAddress, type Address } from 'viem';
import { dealEscrowAbi, plugStakeAbi, levelCap as computeLevelCap } from '@plug360/shared';
import type { PlugCard, PlugStats, PlugProfile, Review } from '@plug360/shared';
import { network } from '@/lib/config';

const PLUG_STAKE_ADDRESS = process.env.NEXT_PUBLIC_PLUG_STAKE_ADDRESS as Address | undefined;

export function usePlugCard(address: Address | undefined): { card: PlugCard | null; loading: boolean; error: string | null } {
  const [card, setCard] = useState<PlugCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publicClient = usePublicClient();

  useEffect(() => {
    if (!address || !publicClient) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      const addr = getAddress(address!);

      // On-chain: plug level + stake
      const [levelRaw, stakedRaw, withdrawRaw] = await Promise.all([
        publicClient!.readContract({ address: network.escrow, abi: dealEscrowAbi, functionName: 'plugLevel', args: [addr] }).catch(() => 0),
        PLUG_STAKE_ADDRESS
          ? publicClient!.readContract({ address: PLUG_STAKE_ADDRESS, abi: plugStakeAbi, functionName: 'stakeOf', args: [addr] }).catch(() => 0n)
          : Promise.resolve(0n),
        PLUG_STAKE_ADDRESS
          ? publicClient!.readContract({ address: PLUG_STAKE_ADDRESS, abi: plugStakeAbi, functionName: 'withdrawRequest', args: [addr] }).catch(() => [0n, 0])
          : Promise.resolve([0n, 0] as [bigint, number]),
      ]);

      const level = Number(levelRaw);
      const staked = BigInt(String(stakedRaw));
      const [withdrawAmount, withdrawUnlocksAt] = withdrawRaw as [bigint, number];

      // Off-chain: stats + reviews + profile in parallel
      const [statsRes, reviewsRes] = await Promise.all([
        fetch(`/api/reputation/stats?plug=${addr}`).catch(() => null),
        fetch(`/api/reputation/reviews?plug=${addr}`).catch(() => null),
      ]);

      const stats: PlugStats | null = statsRes?.ok ? await statsRes.json().catch(() => null) : null;
      const reviews: Review[] = reviewsRes?.ok ? await reviewsRes.json().catch(() => []) : [];

      // Profile: look up CID dynamically (lookup route checks the local store and
      // the keeper stats server, both of which reflect the onchain PlugLevelSet event).
      // Fall back to an env var for backwards compatibility during migration.
      let profileCid: string | null =
        process.env[`NEXT_PUBLIC_PLUG_PROFILE_CID_${addr.toLowerCase()}`] ?? null;
      if (!profileCid) {
        const lookupRes = await fetch(`/api/reputation/profile/lookup?plug=${addr}`).catch(() => null);
        if (lookupRes?.ok) {
          const lookupData = await lookupRes.json().catch(() => null) as { cid?: string } | null;
          profileCid = lookupData?.cid ?? null;
        }
      }
      let profile: PlugProfile | null = null;
      if (profileCid) {
        const profileRes = await fetch(`/api/reputation/profile?cid=${profileCid}`).catch(() => null);
        if (profileRes?.ok) profile = await profileRes.json().catch(() => null);
      }

      const avgRating = reviews.length > 0
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
        : null;

      if (!cancelled) {
        setCard({
          address: addr,
          level,
          levelCap: computeLevelCap(level),
          stats,
          profile,
          profileCid,
          reviews,
          staked,
          withdrawRequest: Number(withdrawUnlocksAt) > 0 ? { amount: withdrawAmount, unlocksAt: Number(withdrawUnlocksAt) } : null,
          avgRating,
        });
        setLoading(false);
      }
    }

    load().catch((err: unknown) => {
      if (!cancelled) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'failed to load plug data');
      }
    });
    return () => { cancelled = true; };
  }, [address, publicClient]);

  return { card, loading, error };
}
