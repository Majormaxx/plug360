'use client';

import { dealEscrowAbi, type Deal } from '@plug360/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getAbiItem, isAddressEqual, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { network } from '@/lib/config';
import { dealIdToHex } from '@/lib/format';
import { scanLogs, ScanError } from '@/lib/scan';
import { loadScan, saveScan, type FundedRecord } from '@/lib/storage';
import { logClients } from '@/lib/wagmi';

const dealFunded = getAbiItem({ abi: dealEscrowAbi, name: 'DealFunded' });

export type MyDeal = FundedRecord & { role: 'buyer' | 'seller' | 'plug'; deal?: Deal };

/**
 * Every deal this account is part of. DealFunded indexes buyer and seller but not the plug, so the scan
 * reads every funding event since the deploy block and filters here. Progress is cached per browser, so
 * later visits only read new blocks.
 */
export function useMyDeals(account: Address | undefined) {
  const [progress, setProgress] = useState<number | undefined>(undefined);

  const scan = useQuery({
    queryKey: ['funded-scan', network.chain.id, network.escrow],
    // Only scan for a connected wallet; anonymous visitors must not spend the public RPC's rate limit.
    enabled: !!account,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const cached = loadScan();
      const deals: FundedRecord[] = cached?.deals ?? [];
      const from = cached ? cached.scannedTo + 1n : network.deployBlock;
      const head = await firstOk(logClients.map((c) => () => c.getBlockNumber()));
      if (from > head) return deals;
      const fresh = !cached || head - from > 20_000n;
      if (fresh) setProgress(0);
      try {
        await scanLogs({
          from,
          to: head,
          signal,
          fetchers: logClients.map((c) => (fromBlock: bigint, toBlock: bigint) =>
            c.getLogs({ address: network.escrow, event: dealFunded, fromBlock, toBlock, strict: true }),
          ),
          onChunk: (logs, to) => {
            for (const l of logs) {
              const a = l.args;
              deals.push({
                id: dealIdToHex(a.dealId),
                buyer: a.buyer,
                seller: a.seller,
                plug: a.plug,
                price: a.price.toString(),
                plugFee: a.plugFee.toString(),
                releaseAt: Number(a.releaseAt),
                block: (l.blockNumber ?? to).toString(),
              });
            }
            saveScan(to, deals);
          },
          onProgress: fresh ? (done, total) => setProgress(Number((done * 100n) / (total || 1n))) : undefined,
        });
      } catch (err) {
        if (err instanceof ScanError && deals.length > 0) return deals;
        throw err;
      } finally {
        setProgress(undefined);
      }
      return deals;
    },
  });

  const mine: MyDeal[] = account
    ? (scan.data ?? []).flatMap((r) => {
        const role = isAddressEqual(r.buyer as Address, account)
          ? 'buyer'
          : isAddressEqual(r.seller as Address, account)
            ? 'seller'
            : isAddressEqual(r.plug as Address, account)
              ? 'plug'
              : undefined;
        return role ? [{ ...r, role }] : [];
      })
    : [];
  mine.sort((a, b) => (BigInt(b.block) > BigInt(a.block) ? 1 : -1));

  const states = useReadContracts({
    contracts: mine.map((d) => ({
      address: network.escrow,
      abi: dealEscrowAbi,
      chainId: network.chain.id,
      functionName: 'getDeal' as const,
      args: [BigInt(d.id)] as const,
    })),
    allowFailure: true,
    query: { enabled: mine.length > 0, refetchInterval: 15_000 },
  });

  const withState = mine.map((d, i) => {
    const r = states.data?.[i];
    return r?.status === 'success' ? { ...d, deal: r.result as Deal } : d;
  });

  return { deals: withState, scan, statesLoading: states.isLoading, progress };
}

async function firstOk<T>(fns: Array<() => Promise<T>>): Promise<T> {
  let last: unknown;
  for (const fn of fns) {
    try {
      return await fn();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
