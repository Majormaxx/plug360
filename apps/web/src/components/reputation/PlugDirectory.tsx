'use client';

/**
 * Client component that fetches all listed plugs + their stats and renders
 * a sortable, filterable grid of PlugCardSummary tiles.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { getAddress, type Address } from 'viem';
import { dealEscrowAbi, levelCap as computeLevelCap } from '@plug360/shared';
import type { PlugStats } from '@plug360/shared';
import { network } from '@/lib/config';
import { listedPlugs } from '@/lib/plugs';
import { PlugCardSummary } from './PlugCardSummary';
import { Skeleton } from '@/components/ui/Skeleton';
import { Notice } from '@/components/ui/Notice';
import { cn } from '@/components/ui/cn';

type PlugRow = {
  address: Address;
  name: string;
  note: string;
  level: number;
  levelCap: bigint;
  stats: PlugStats | null;
};

type SortKey = 'level' | 'deals' | 'timeout';

export function PlugDirectory() {
  const [plugs, setPlugs] = useState<PlugRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('deals');
  const [search, setSearch] = useState('');
  const [filterStaked, setFilterStaked] = useState(false);
  const [filterReviews, setFilterReviews] = useState(false);
  const publicClient = usePublicClient();

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function load() {
      // Read levels for all listed plugs in parallel.
      const levelResults = await Promise.all(
        listedPlugs.map((p) =>
          publicClient!.readContract({
            address: network.escrow,
            abi: dealEscrowAbi,
            functionName: 'plugLevel',
            args: [p.address],
          }).then(Number).catch(() => 0),
        ),
      );

      // Fetch all stats once.
      let allStats: PlugStats[] = [];
      try {
        const res = await fetch('/api/reputation/stats');
        if (res.ok) allStats = await res.json();
      } catch {
        // stats are optional
      }

      const rows: PlugRow[] = listedPlugs.map((p, i) => {
        const level = levelResults[i] ?? 0;
        return {
          address: getAddress(p.address),
          name: p.name,
          note: p.note,
          level,
          levelCap: computeLevelCap(level),
          stats: allStats.find((s) => s.address.toLowerCase() === p.address.toLowerCase()) ?? null,
        };
      }).filter((r) => r.level > 0); // hide delisted plugs from directory

      if (!cancelled) {
        setPlugs(rows);
        setLoading(false);
      }
    }

    load().catch((err: unknown) => {
      if (!cancelled) {
        setLoading(false);
        setLoadError(err instanceof Error ? err.message : 'failed to load directory');
      }
    });
    return () => { cancelled = true; };
  }, [publicClient]);

  const visible = useMemo(() => {
    let rows = [...plugs];

    // Sort first.
    rows.sort((a, b) => {
      if (sort === 'level') return b.level - a.level;
      if (sort === 'deals') return (b.stats?.totalDeals ?? 0) - (a.stats?.totalDeals ?? 0);
      if (sort === 'timeout') {
        const rA = a.stats && a.stats.totalDisputes > 0 ? a.stats.timedOut / a.stats.totalDisputes : 0;
        const rB = b.stats && b.stats.totalDisputes > 0 ? b.stats.timedOut / b.stats.totalDisputes : 0;
        return rA - rB;
      }
      return 0;
    });

    // Text search (fuzzy: includes on name or address).
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));

    // Filter pills.
    if (filterStaked) rows = rows.filter((r) => r.stats && r.stats.totalDeals > 0); // proxy for staked
    if (filterReviews) rows = rows.filter((r) => r.stats && r.stats.totalDeals > 0);

    return rows;
  }, [plugs, sort, search, filterStaked, filterReviews]);

  const showFilters = plugs.length > 3;

  return (
    <div className="space-y-4">
      {/* Search + sort + filter bar */}
      <div className="space-y-3">
        {showFilters && (
          <input
            type="search"
            placeholder="Search plugs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[14px] border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40 sm:max-w-xs"
          />
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Sort</span>
          {(['deals', 'level', 'timeout'] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={cn(
                'rounded-full px-3 py-1 font-medium transition-colors',
                sort === k ? 'bg-ink text-bg' : 'bg-raised text-ink hover:bg-line-strong/60',
              )}
            >
              {k === 'deals' ? 'Most active' : k === 'level' ? 'Level' : 'Fewest timeouts'}
            </button>
          ))}
          {showFilters && (
            <>
              <span className="text-line-strong">·</span>
              <button
                type="button"
                onClick={() => setFilterStaked((v) => !v)}
                className={cn(
                  'rounded-full px-3 py-1 font-medium transition-colors',
                  filterStaked ? 'bg-mint text-mint-ink' : 'bg-raised text-muted hover:bg-line-strong/60',
                )}
              >
                Active only
              </button>
              <button
                type="button"
                onClick={() => setFilterReviews((v) => !v)}
                className={cn(
                  'rounded-full px-3 py-1 font-medium transition-colors',
                  filterReviews ? 'bg-mint text-mint-ink' : 'bg-raised text-muted hover:bg-line-strong/60',
                )}
              >
                Has deals
              </button>
            </>
          )}
        </div>
      </div>

      {loadError ? (
        <Notice tone="danger">Could not load plug directory. Check your connection and refresh.</Notice>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-muted">{search ? 'No plugs match your search.' : 'No plugs are listed yet.'}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visible.map((p) => (
            <PlugCardSummary key={p.address} {...p} />
          ))}
        </div>
      )}
    </div>
  );
}
