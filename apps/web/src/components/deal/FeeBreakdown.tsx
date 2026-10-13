import { payoutSplit } from '@/lib/deal';
import { Amount } from '../ui/Amount';
import { cn } from '../ui/cn';

/** Who pays and who gets what, including the plug's half-and-half fee. */
export function FeeBreakdown({ price, plugFee, highlight, className }: { price: bigint; plugFee: bigint; highlight?: 'buyer' | 'seller' | 'plug'; className?: string }) {
  const s = payoutSplit(price, plugFee);
  const rows = [
    { key: 'buyer', label: 'Buyer pays', value: s.escrowed, note: plugFee > 0n ? 'price + half the plug fee' : 'the price' },
    { key: 'seller', label: 'Seller receives', value: s.toSeller, note: plugFee > 0n ? 'price − half the plug fee' : 'the full price' },
    { key: 'plug', label: 'Plug earns', value: s.toPlug, note: 'on payout' },
  ] as const;
  return (
    <dl className={cn('divide-y divide-line rounded-[16px] border border-line', className)}>
      {rows.map((r) => (
        <div key={r.key} className={cn('flex items-center justify-between gap-3 px-4 py-3', highlight === r.key && 'bg-accent-soft first:rounded-t-[15px] last:rounded-b-[15px]')}>
          <dt className="min-w-0">
            <span className="text-sm font-medium">{r.label}</span>
            <span className="ml-2 hidden text-xs text-faint sm:inline">{r.note}</span>
          </dt>
          <dd className={cn(r.key === 'buyer' ? 'font-semibold' : 'font-medium')}>
            <Amount value={r.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
