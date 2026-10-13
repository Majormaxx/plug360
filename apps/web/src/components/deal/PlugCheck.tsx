'use client';

import { SealCheck, WarningCircle } from '@phosphor-icons/react';
import { isAddress } from 'viem';
import { usePlugLevel } from '@/hooks/useEscrow';
import { usdc } from '@/lib/format';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';

/** Live listing check for a plug address: level, price cap, or "not listed". */
export function PlugCheck({ plug }: { plug: string }) {
  const { level, cap, isLoading, isError } = usePlugLevel(plug);
  if (!plug || !isAddress(plug)) return null;
  if (isLoading) return <Skeleton className="h-6 w-40 rounded-full" />;
  if (isError || level === undefined) return <span className="text-sm text-muted">Couldn&apos;t check this plug right now.</span>;
  if (level === 0) {
    return (
      <Badge tone="danger">
        <WarningCircle weight="fill" className="size-3.5" />
        Not a listed plug
      </Badge>
    );
  }
  return (
    <Badge tone="gold">
      <SealCheck weight="fill" className="size-3.5" />
      Level {level} plug · up to {usdc(cap ?? 0n)} USDC
    </Badge>
  );
}
