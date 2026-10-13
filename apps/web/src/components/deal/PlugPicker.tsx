'use client';

import { SealCheck } from '@phosphor-icons/react';
import { dealEscrowAbi } from '@plug360/shared';
import { useEffect, useMemo, useState } from 'react';
import { getAddress, isAddressEqual, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { network } from '@/lib/config';
import { shortAddress } from '@/lib/format';
import { listedPlugs } from '@/lib/plugs';
import { recentPlugs } from '@/lib/storage';
import { cn } from '../ui/cn';

/** One-tap choices for the plug field: plugs you used before and plugs in the public directory. */
export function PlugPicker({ value, exclude, onPick }: { value: string; exclude?: Address; onPick: (a: Address) => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(recentPlugs()), []);

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { address: Address; label: string }[] = [];
    for (const r of recent) out.push({ address: getAddress(r), label: listedPlugs.find((p) => isAddressEqual(p.address, r as Address))?.name ?? shortAddress(r) });
    for (const p of listedPlugs) out.push({ address: p.address, label: p.name });
    return out.filter((o) => {
      const k = o.address.toLowerCase();
      if (seen.has(k) || (exclude && isAddressEqual(o.address, exclude))) return false;
      seen.add(k);
      return true;
    });
  }, [recent, exclude]);

  // The contract decides who is listed; the directory only supplies names.
  const levels = useReadContracts({
    contracts: options.map((o) => ({ address: network.escrow, abi: dealEscrowAbi, chainId: network.chain.id, functionName: 'plugLevel' as const, args: [o.address] as const })),
    allowFailure: true,
    query: { enabled: options.length > 0, staleTime: 60_000 },
  });

  const visible = options
    .map((o, i) => ({ ...o, level: levels.data?.[i]?.status === 'success' ? Number(levels.data[i]!.result) : undefined }))
    .filter((o) => o.level === undefined || o.level > 0);

  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Suggested plugs">
      {visible.map((o) => {
        const active = value.toLowerCase() === o.address.toLowerCase();
        return (
          <button
            key={o.address}
            type="button"
            onClick={() => onPick(o.address)}
            aria-pressed={active}
            className={cn('press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors', active ? 'border-ink bg-ink text-bg' : 'border-line-strong text-ink hover:bg-raised')}
          >
            {o.level !== undefined && <SealCheck weight="fill" className={cn('size-3.5', active ? 'text-gold' : 'text-gold-ink')} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
