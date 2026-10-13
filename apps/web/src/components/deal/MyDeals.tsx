'use client';

import { ArrowRight, Stack, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useMyDeals, type MyDeal } from '@/hooks/useMyDeals';
import { useNow } from '@/hooks/useNow';
import { viewDeal } from '@/lib/deal';
import { duration } from '@/lib/format';
import { titleOf } from '@/lib/storage';
import { Amount } from '../ui/Amount';
import { Button, ButtonLink } from '../ui/Button';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/EmptyState';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { Skeleton } from '../ui/Skeleton';
import { Switch } from '../ui/Switch';
import { ConnectButton } from '../wallet/ConnectButton';
import { StatusBadge } from './StatusBadge';

type Filter = 'all' | 'buyer' | 'seller' | 'plug';

export function MyDeals() {
  const { address, status } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { deals, scan, progress, statesLoading } = useMyDeals(address);
  const [filter, setFilter] = useState<Filter>('all');
  const [hideDone, setHideDone] = useState(false);
  const now = useNow(10_000);

  const rows = useMemo(
    () =>
      deals.map((d) => ({ d, view: d.deal ? viewDeal(d.deal, d.role, now) : undefined })).filter(({ d, view }) => (filter === 'all' || d.role === filter) && !(hideDone && view?.final)),
    [deals, filter, hideDone, now],
  );
  const needsYou = deals.filter((d) => d.deal && viewDeal(d.deal, d.role, now).actions.some((a) => a !== 'withdraw' && a !== 'retry')).length;

  if (!mounted || status === 'reconnecting') return <ListSkeleton />;
  if (!address) {
    return (
      <EmptyState icon={<Stack className="size-5" />} title="See your deals" action={<ConnectButton size="lg" label="Connect wallet" />}>
        Connect a wallet to list every deal it&apos;s part of, as buyer, seller or plug.
      </EmptyState>
    );
  }

  const count = (r: Filter) => (r === 'all' ? deals.length : deals.filter((d) => d.role === r).length);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          label="Filter by role"
          size="sm"
          value={filter}
          onChange={setFilter}
          className="sm:w-[440px]"
          options={(['all', 'buyer', 'seller', 'plug'] as const).map((r) => ({
            value: r,
            label: `${{ all: 'All', buyer: 'Buying', seller: 'Selling', plug: 'Refereeing' }[r]}${scan.data ? ` ${count(r)}` : ''}`,
          }))}
        />
        <div className="sm:w-56">
          <Switch checked={hideDone} onChange={setHideDone} label="Hide finished" />
        </div>
      </div>

      {needsYou > 0 && (
        <Notice tone="warn" title={`${needsYou} ${needsYou === 1 ? 'deal needs' : 'deals need'} you`}>
          Look for the orange marker below.
        </Notice>
      )}

      {progress !== undefined && (
        <div className="space-y-2 rounded-[16px] bg-raised p-4" role="status">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Reading deals from Arc</span>
            <span className="tabular text-muted">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted">The first visit reads every deal since launch. Later visits only read what&apos;s new.</p>
        </div>
      )}

      {scan.isError && !scan.data && (
        <Notice tone="danger" title="Couldn't read deals from Arc" action={<Button size="sm" variant="ink" onClick={() => scan.refetch()}>Try again</Button>}>
          The network didn&apos;t answer. Your deals are safe; this list just couldn&apos;t load.
        </Notice>
      )}

      {scan.isPending && progress === undefined ? (
        <ListSkeleton />
      ) : rows.length === 0 && scan.data ? (
        deals.length === 0 ? (
          <EmptyState icon={<Stack className="size-5" />} title="No deals yet" action={<ButtonLink href="/new">Start a deal</ButtonLink>}>
            Deals you pay for, sell or referee will show up here once they&apos;re funded.
          </EmptyState>
        ) : (
          <p className="py-10 text-center text-sm text-muted">Nothing matches these filters.</p>
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map(({ d, view }) => (
            <DealRow key={d.id} d={d} view={view} now={now} loadingState={statesLoading} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DealRow({ d, view, now, loadingState }: { d: MyDeal; view: ReturnType<typeof viewDeal> | undefined; now: number; loadingState: boolean }) {
  const [title, setTitle] = useState<string>();
  useEffect(() => setTitle(titleOf(d.id)), [d.id]);
  const mine = view?.actions.some((a) => a !== 'withdraw' && a !== 'retry');
  const sub =
    view?.phase === 'window'
      ? `Window closes in ${duration(view.windowEndsAt - now)}`
      : view?.phase === 'disputed'
        ? `Plug decides within ${duration(view.plugDeadline - now)}`
        : undefined;
  return (
    <li>
      <Link href={`/r/${d.id}`} className="press group flex h-full flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong">
        <div className="flex items-center justify-between gap-3">
          {view ? <StatusBadge phase={view.phase} /> : loadingState ? <Skeleton className="h-6 w-24 rounded-full" /> : <Warning className="size-4 text-muted" />}
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            {mine && <span className="size-2 rounded-full bg-accent" aria-label="Needs you" />}
            {{ buyer: 'Buying', seller: 'Selling', plug: 'Refereeing' }[d.role]}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{title || `Deal ${d.id.slice(0, 10)}…`}</p>
          {sub && <p className="text-sm text-muted">{sub}</p>}
        </div>
        <div className="mt-auto flex items-center justify-between">
          <Amount value={BigInt(d.price)} className="font-display text-lg font-semibold" />
          <ArrowRight className={cn('size-4 text-muted transition-transform duration-200 ease-out group-hover:translate-x-0.5')} />
        </div>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-36 rounded-[20px]" />
      ))}
    </div>
  );
}
