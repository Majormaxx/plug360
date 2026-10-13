import { usdc } from '@/lib/format';
import { cn } from './cn';

export function Amount({ value, className, unit = true }: { value: bigint; className?: string; unit?: boolean }) {
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      {usdc(value)}
      {unit && <span className="ml-1 text-[0.72em] font-medium text-muted">USDC</span>}
    </span>
  );
}
