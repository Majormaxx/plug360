'use client';

import { dealEscrowAbi, levelCap, USDC, type Deal } from '@plug360/shared';
import { erc20Abi, isAddress, type Address } from 'viem';
import { useReadContract, useReadContracts } from 'wagmi';
import { network } from '@/lib/config';

const escrow = { address: network.escrow, abi: dealEscrowAbi, chainId: network.chain.id } as const;

/** A funded deal plus any parked payout legs. Polls while the page is open so every party sees changes. */
export function useDeal(id: bigint | undefined) {
  const q = useReadContracts({
    contracts: id === undefined ? [] : [
      { ...escrow, functionName: 'getDeal', args: [id] },
      { ...escrow, functionName: 'pendingPayouts', args: [id] },
    ],
    allowFailure: false,
    query: { enabled: id !== undefined, refetchInterval: 5_000 },
  });
  const [deal, pending] = (q.data ?? []) as unknown as [Deal | undefined, readonly [bigint, bigint, bigint] | undefined];
  return {
    ...q,
    deal,
    pending: pending ? { toRefund: pending[0], toSeller: pending[1], toPlug: pending[2] } : undefined,
  };
}

/** Listing level of a plug (0 = not listed) and the price cap that level allows. */
export function usePlugLevel(plug: string | undefined) {
  const valid = !!plug && isAddress(plug);
  const q = useReadContract({
    ...escrow,
    functionName: 'plugLevel',
    args: valid ? [plug as Address] : undefined,
    query: { enabled: valid, staleTime: 30_000 },
  });
  const level = q.data === undefined ? undefined : Number(q.data);
  return { ...q, level, cap: level === undefined ? undefined : levelCap(level) };
}

export function useEscrowStatus() {
  const q = useReadContracts({
    contracts: [
      { ...escrow, functionName: 'paused' },
      { ...escrow, functionName: 'totalHeld' },
    ],
    allowFailure: false,
    query: { refetchInterval: 15_000 },
  });
  const [paused, totalHeld] = (q.data ?? []) as [boolean | undefined, bigint | undefined];
  return { ...q, paused, totalHeld };
}

/** USDC balance (6 decimals) and the allowance this account gave the escrow. */
export function useUsdc(account: Address | undefined) {
  const usdc = { address: USDC, abi: erc20Abi, chainId: network.chain.id } as const;
  const q = useReadContracts({
    contracts: account ? [
      { ...usdc, functionName: 'balanceOf', args: [account] },
      { ...usdc, functionName: 'allowance', args: [account, network.escrow] },
    ] : [],
    allowFailure: false,
    query: { enabled: !!account, refetchInterval: 8_000 },
  });
  const [balance, allowance] = (q.data ?? []) as [bigint | undefined, bigint | undefined];
  return { ...q, balance, allowance };
}
