'use client';

import { useQuery } from '@tanstack/react-query';
import { formatNaira, type NgnRate } from '@/lib/fx';
import { cn } from '../ui/cn';

/** Shared by every naira line on the page: one request a minute, and nothing rendered if no rate is available. */
export function useNgnRate() {
  return useQuery({
    queryKey: ['ngn-rate'],
    queryFn: async (): Promise<NgnRate> => {
      const res = await fetch('/api/rate');
      if (!res.ok) throw new Error('No rate');
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

/** "≈ ₦34,075" for a USDC amount, with the rate and its source on hover and for screen readers. */
export function NairaHint({ usdc, className, detail = false }: { usdc: number | undefined; className?: string; detail?: boolean }) {
  const { data } = useNgnRate();
  if (!data || usdc === undefined || !(usdc > 0)) return null;
  const label = `${data.kind === 'market' ? 'Market rate' : 'Official rate'} ₦${Math.round(data.rate).toLocaleString('en-NG')} per USDC from ${data.source}, ${timeOf(data.at)}`;
  return (
    <span className={cn('tabular text-sm text-muted', className)} title={label} aria-label={`About ${formatNaira(usdc, data.rate)}. ${label}`}>
      ≈ <span className="font-medium text-ink">{formatNaira(usdc, data.rate)}</span>
      {detail && (
        <span className="hidden text-faint sm:inline">
          {' '}
          at ₦{Math.round(data.rate).toLocaleString('en-NG')}/USDC, {data.kind} rate
        </span>
      )}
    </span>
  );
}
