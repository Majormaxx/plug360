import type { Review } from '@plug360/shared';
import { dateTime, shortAddress } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5 text-sm" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? 'text-gold' : 'text-raised'}>★</span>
      ))}
    </span>
  );
}

export function ReviewList({ reviews }: { reviews: Review[] }) {
  const sorted = [...reviews].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <ul className="space-y-3">
      {sorted.map((r) => (
        <li key={r.id} className="rounded-[14px] border border-line bg-raised px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Stars rating={r.rating} />
            <div className="flex items-center gap-2 text-xs text-muted">
              {r.wasDisputed && <Badge tone="gold">disputed deal</Badge>}
              <span title={r.buyerAddress}>{shortAddress(r.buyerAddress)}</span>
              <span>·</span>
              <time>{dateTime(r.createdAt)}</time>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-ink">{r.text}</p>
        </li>
      ))}
    </ul>
  );
}
