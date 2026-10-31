'use client';

/**
 * Compact plug reputation card, shown inline in the deal room when a plug address
 * is named. Loads on demand and shows the most trust-relevant signals at a glance.
 */
import { type Address } from 'viem';
import { usePlugCard } from '@/hooks/usePlugCard';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { usdc } from '@/lib/format';
import { cn } from '@/components/ui/cn';
import Link from 'next/link';

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'mint' | 'gold' | 'danger' | 'neutral' }) {
  const tones = {
    mint: 'text-mint-ink',
    gold: 'text-gold-ink',
    danger: 'text-danger-ink',
    neutral: 'text-ink',
  };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={cn('text-xs font-semibold', tones[tone ?? 'neutral'])}>{value}</span>
    </div>
  );
}

export function PlugCardInline({ address }: { address: Address }) {
  const { card, loading, error } = usePlugCard(address);

  if (error) {
    return (
      <div className="mt-2 rounded-[14px] border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger-ink">
        Could not load plug data — check your connection.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-2 rounded-[14px] border border-line bg-raised p-3 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
    );
  }

  if (!card) return null;
  const { level, levelCap: cap, profile, stats, staked, avgRating, reviews } = card;

  const timeoutRate = stats && stats.totalDisputes > 0
    ? stats.timedOut / stats.totalDisputes
    : 0;
  const timeoutTone = timeoutRate === 0 ? 'mint' : timeoutRate < 0.15 ? 'gold' : 'danger';

  return (
    <div className="mt-2 rounded-[14px] border border-line bg-raised p-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium text-sm">{profile?.name ?? 'Unnamed plug'}</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {level > 0 ? (
            <Badge tone="gold">Level {level} · up to ${usdc(cap)}</Badge>
          ) : (
            <Badge tone="danger">Delisted</Badge>
          )}
          {staked > 0n && <Badge tone="mint">${usdc(staked)} staked</Badge>}
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="flex flex-wrap gap-3">
          <MiniStat label="Deals" value={String(stats.totalDeals)} tone="neutral" />
          <MiniStat
            label="Timeout rate"
            value={stats.totalDisputes === 0 ? 'no disputes' : stats.timedOut === 0 ? '0%' : `${Math.round(timeoutRate * 100)}%`}
            tone={timeoutTone}
          />
          {stats.medianRulingHours !== null && (
            <MiniStat label="Median ruling" value={stats.medianRulingHours < 1 ? '<1 h' : `${Math.round(stats.medianRulingHours)} h`} tone="neutral" />
          )}
          {avgRating !== null && (
            <MiniStat label={`Reviews (${reviews.length})`} value={`${avgRating.toFixed(1)} / 5`} tone="neutral" />
          )}
        </div>
      )}

      {!stats && <p className="text-xs text-muted">No on-chain stats yet — this may be a new plug.</p>}

      {/* Link to full card */}
      <Link href={`/plugs/${address}`} className="text-xs text-accent hover:underline">
        View full profile →
      </Link>
    </div>
  );
}
