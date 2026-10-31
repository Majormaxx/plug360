import type { PlugStats } from '@plug360/shared';
import { usdc } from '@/lib/format';
import { cn } from '@/components/ui/cn';

/** Colour-codes the timeout rate: green < 5%, amber 5-15%, red > 15%. */
function TimeoutBadge({ timedOut, total }: { timedOut: number; total: number }) {
  const rate = total === 0 ? 0 : (timedOut / total) * 100;
  const tone = rate === 0 ? 'mint' : rate < 15 ? 'gold' : 'danger';
  const tones = { mint: 'bg-mint-soft text-mint-ink', gold: 'bg-gold-soft text-gold-ink', danger: 'bg-danger-soft text-danger-ink' };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {timedOut === 0 ? '0 timeouts' : `${timedOut} timeout${timedOut > 1 ? 's' : ''}`}
    </span>
  );
}

/** Star bar 1-5. */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn('text-sm', n <= Math.round(rating) ? 'text-gold' : 'text-raised')}>★</span>
      ))}
    </span>
  );
}

export function PlugStatBar({ stats, avgRating, reviewCount }: { stats: PlugStats; avgRating: number | null; reviewCount: number }) {
  const { totalDeals, recentDeals, totalUsdcRefereed, totalDisputes, ruledForBuyer, ruledForSeller, timedOut, medianRulingHours } = stats;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
      <Stat label="Deals (90d)" value={`${totalDeals} total / ${recentDeals} recent`} />
      <Stat label="USDC refereed" value={`$${usdc(BigInt(totalUsdcRefereed))}`} />
      {totalDisputes > 0 ? (
        <Stat
          label="Disputes"
          value={
            <span className="flex flex-wrap items-center gap-1.5">
              {totalDisputes} total
              <TimeoutBadge timedOut={timedOut} total={totalDisputes} />
            </span>
          }
        />
      ) : (
        <Stat label="Disputes" value="none" />
      )}
      {totalDisputes > 0 && (
        <Stat label="Rulings" value={`${ruledForBuyer} for buyer / ${ruledForSeller} for seller`} />
      )}
      {medianRulingHours !== null && (
        <Stat label="Median ruling" value={`${medianRulingHours < 1 ? '<1 h' : `${Math.round(medianRulingHours)} h`}`} />
      )}
      {avgRating !== null && (
        <Stat
          label={`Reviews (${reviewCount})`}
          value={
            <span className="flex items-center gap-1.5">
              <Stars rating={avgRating} />
              <span className="text-muted">{avgRating.toFixed(1)}</span>
            </span>
          }
        />
      )}
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
