import Link from 'next/link';
import type { Address } from 'viem';
import type { PlugStats } from '@plug360/shared';
import { Badge } from '@/components/ui/Badge';
import { usdc, shortAddress } from '@/lib/format';
import { cn } from '@/components/ui/cn';

type Props = {
  address: Address;
  name: string;
  note: string;
  level: number;
  levelCap: bigint;
  stats: PlugStats | null;
};

function TimeoutDot({ timedOut, total }: { timedOut: number; total: number }) {
  const rate = total === 0 ? 0 : timedOut / total;
  const tone = rate === 0 ? 'mint' : rate < 0.15 ? 'gold' : 'danger';
  return <span className={cn('size-2 rounded-full shrink-0', { mint: 'bg-mint', gold: 'bg-gold', danger: 'bg-danger' }[tone])} />;
}

export function PlugCardSummary({ address, name, note, level, levelCap: cap, stats }: Props) {
  const isNew = !stats || stats.totalDeals === 0;
  return (
    <Link
      href={`/plugs/${address}`}
      className="group block rounded-[20px] border border-line bg-surface p-5 shadow-card space-y-3 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_4px_20px_-4px_rgb(23_20_31/0.18)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink leading-snug truncate">{name}</p>
          <p className="text-xs text-muted mt-0.5 truncate">{shortAddress(address)}</p>
        </div>
        <Badge tone="gold" className="shrink-0">Level {level}</Badge>
      </div>

      <p className="text-sm text-muted line-clamp-2">{note}</p>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-raised px-2.5 py-1 text-muted">up to ${usdc(cap)}</span>
        {isNew ? (
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-accent">New plug · be their first</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-muted">
              {stats.totalDeals} deal{stats.totalDeals !== 1 ? 's' : ''}
            </span>
            {stats.totalDisputes > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-muted">
                <TimeoutDot timedOut={stats.timedOut} total={stats.totalDisputes} />
                {stats.timedOut === 0 ? '0 timeouts' : `${stats.timedOut} timeout${stats.timedOut > 1 ? 's' : ''}`}
              </span>
            )}
          </>
        )}
      </div>
    </Link>
  );
}
