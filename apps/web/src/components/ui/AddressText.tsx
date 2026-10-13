'use client';

import { ArrowSquareOut } from '@phosphor-icons/react';
import { getAddress, isAddressEqual, type Address } from 'viem';
import { useAccount } from 'wagmi';
import { explorerAddress } from '@/lib/config';
import { addressChunks } from '@/lib/format';
import { CopyButton } from './CopyButton';
import { cn } from './cn';

/**
 * Always the full address in groups of four. Poisoning bots send dust from look-alike addresses that match
 * the first and last characters, so a shortened address is not safe to compare.
 */
export function AddressText({ address, className, compact }: { address: Address; className?: string; compact?: boolean }) {
  const { address: me } = useAccount();
  const checksum = getAddress(address);
  const isMe = me ? isAddressEqual(me, checksum) : false;
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <code
        translate="no"
        className={cn('min-w-0 flex-1 font-mono leading-relaxed text-ink', compact ? 'text-[12px]' : 'text-[13px]')}
        aria-label={checksum}
      >
        <span className="text-faint">0x</span>
        {addressChunks(checksum).map((c, i) => (
          <span key={i} className={cn(i % 2 === 1 && 'text-muted', 'inline-block mr-[0.28em] last:mr-0')}>
            {c}
          </span>
        ))}
        {isMe && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 align-middle font-sans text-[11px] font-medium text-ink">you</span>}
      </code>
      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        <CopyButton value={checksum} label="Copy address" />
        <a
          href={explorerAddress(checksum)}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in explorer"
          className="text-muted transition-colors hover:text-ink"
        >
          <ArrowSquareOut className="size-4" />
        </a>
      </span>
    </div>
  );
}
