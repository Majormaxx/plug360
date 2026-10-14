'use client';

import { ArrowSquareOut, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import { dealEscrowAbi, type Deal } from '@plug360/shared';
import { useEffect, useState } from 'react';
import { keccak256, stringToBytes, type PublicClient } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { useDeal } from '@/hooks/useEscrow';
import { useNow } from '@/hooks/useNow';
import { contractStep, useTx } from '@/hooks/useTx';
import type { SponsoredAction } from '@plug360/sponsor/contract';

const SPONSORED = new Set<string>(['openDispute', 'release', 'refund', 'plugRefund', 'plugReject']);
import { explorerTx, network } from '@/lib/config';
import { payoutSplit, roleOf, viewDeal, type ActionId, type DealView, type Role } from '@/lib/deal';
import { dateTime, dealIdToHex, duration } from '@/lib/format';
import { activityFor, titleOf, type Activity } from '@/lib/storage';
import { AddressText } from '../ui/AddressText';
import { Amount } from '../ui/Amount';
import { Button, ButtonLink } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/EmptyState';
import { Field, TextArea } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Panel, PanelHeader } from '../ui/Panel';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ConnectButton } from '../wallet/ConnectButton';
import { StatusBadge } from './StatusBadge';
import { TxStatus } from './TxStatus';

type ActionSpec = {
  label: string;
  /** Long label for the confirm sheet. */
  confirm: string;
  variant: 'primary' | 'ink' | 'soft' | 'danger';
  /** What happens, in plain words, with amounts. */
  explain: (d: Deal) => React.ReactNode;
  fn: 'release' | 'openDispute' | 'refund' | 'plugRefund' | 'plugReject' | 'withdraw' | 'finalizeExpiredDispute' | 'retryPayout';
  note?: { label: string; hint: string; required: boolean };
  irreversible: boolean;
};

const ACTIONS: Record<ActionId, ActionSpec> = {
  release: {
    label: 'Release payment',
    confirm: 'Release the payment to the seller?',
    variant: 'primary',
    fn: 'release',
    irreversible: true,
    explain: (d) => (
      <>The seller can then be paid <Amount value={payoutSplit(d.price, d.plugFee).toSeller} /> right away. You can&apos;t dispute after releasing.</>
    ),
  },
  dispute: {
    label: 'Open a dispute',
    confirm: 'Open a dispute',
    variant: 'soft',
    fn: 'openDispute',
    irreversible: true,
    note: { label: "What's wrong?", hint: 'Only a fingerprint of this text goes on-chain. Send the full text to your plug yourself.', required: true },
    explain: () => <>Your plug gets 7 days to decide: refund you, or pay the seller. If they don&apos;t decide in time, you get everything back.</>,
  },
  refund: {
    label: 'Refund the buyer',
    confirm: 'Send the money back to the buyer?',
    variant: 'danger',
    fn: 'refund',
    irreversible: true,
    explain: (d) => <>The buyer gets back all <Amount value={payoutSplit(d.price, d.plugFee).escrowed} />, including their half of the plug fee. The deal ends.</>,
  },
  plugRefund: {
    label: 'Rule for the buyer',
    confirm: 'Refund the buyer?',
    variant: 'danger',
    fn: 'plugRefund',
    irreversible: true,
    note: { label: 'Reason (optional)', hint: 'Only a fingerprint goes on-chain. Tell both sides your reasoning directly.', required: false },
    explain: (d) => {
      const s = payoutSplit(d.price, d.plugFee);
      return <>The buyer gets <Amount value={s.plugRefundToBuyer} /> back. You keep the buyer&apos;s half of the fee, <Amount value={s.plugRefundToPlug} />, for ruling.</>;
    },
  },
  plugReject: {
    label: 'Rule for the seller',
    confirm: 'Reject the dispute and pay the seller?',
    variant: 'ink',
    fn: 'plugReject',
    irreversible: true,
    note: { label: 'Reason (optional)', hint: 'Only a fingerprint goes on-chain. Tell both sides your reasoning directly.', required: false },
    explain: (d) => {
      const s = payoutSplit(d.price, d.plugFee);
      return <>The deal is released. The seller can then be paid <Amount value={s.toSeller} /> and you earn the full fee, <Amount value={s.toPlug} />.</>;
    },
  },
  withdraw: {
    label: 'Pay out now',
    confirm: 'Pay out this deal?',
    variant: 'primary',
    fn: 'withdraw',
    irreversible: false,
    explain: (d) => {
      const s = payoutSplit(d.price, d.plugFee);
      return <>Sends <Amount value={s.toSeller} /> to the seller{s.toPlug > 0n && <> and <Amount value={s.toPlug} /> to the plug</>}. Plug360 does this for you automatically; use this only if you don&apos;t want to wait.</>;
    },
  },
  finalize: {
    label: 'Refund the buyer',
    confirm: 'Close the expired dispute?',
    variant: 'primary',
    fn: 'finalizeExpiredDispute',
    irreversible: false,
    explain: (d) => <>The plug didn&apos;t rule in time, so the buyer gets back all <Amount value={payoutSplit(d.price, d.plugFee).escrowed} />. Anyone can trigger this.</>,
  },
  retry: {
    label: 'Retry stuck payout',
    confirm: 'Retry the stuck payout?',
    variant: 'soft',
    fn: 'retryPayout',
    irreversible: false,
    explain: () => <>A transfer failed earlier, usually because the receiving address was blocked by USDC. Retrying sends it to the same address, never anywhere else.</>,
  },
};

export function Receipt({ id }: { id: bigint }) {
  const idHex = dealIdToHex(id);
  const { deal, pending, isLoading, isError, refetch } = useDeal(id);
  const { address } = useAccount();
  const now = useNow();
  const [title, setTitle] = useState<string>();
  const [activity, setActivity] = useState<Activity[]>([]);
  useEffect(() => {
    setTitle(titleOf(idHex));
    setActivity(activityFor(idHex));
  }, [idHex, deal?.status]);

  if (isLoading || (now === 0 && !isError)) return <ReceiptSkeleton />;
  if (isError || !deal) {
    return (
      <EmptyState icon={<Warning className="size-5" />} title="Couldn't load this deal" action={<Button variant="soft" onClick={() => refetch()}>Try again</Button>}>
        The Arc network didn&apos;t answer. Check your connection and try again.
      </EmptyState>
    );
  }
  const role = roleOf(deal, address);
  const view = viewDeal(deal, role, now);
  if (view.phase === 'missing') {
    return (
      <EmptyState icon={<MagnifyingGlass className="size-5" />} title="No deal here yet" action={<ButtonLink href="/me" variant="soft">See my deals</ButtonLink>}>
        There&apos;s no funded deal with this id on {network.chain.name}. If it was just paid, give it a few seconds.
      </EmptyState>
    );
  }
  const split = payoutSplit(deal.price, deal.plugFee);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <header className="lg:col-span-2 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge phase={view.phase} />
          {role !== 'viewer' && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted">You&apos;re the {role}</span>}
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-balance sm:text-4xl">{title || 'Deal receipt'}</h1>
        <Amount value={deal.price} className="font-display text-2xl font-semibold" />
      </header>
      <div className="order-2 space-y-6 lg:order-none">

        <StatusHero view={view} deal={deal} role={role} now={now} />

        {deal.payoutPending && pending && (
          <Notice tone="warn" title="A payout is waiting">
            A transfer didn&apos;t go through, usually because USDC blocked the receiving address. It stays reserved for that address
            {pending.toRefund > 0n && <> (refund: <Amount value={pending.toRefund} />)</>}
            {pending.toSeller > 0n && <> (seller: <Amount value={pending.toSeller} />)</>}
            {pending.toPlug > 0n && <> (plug: <Amount value={pending.toPlug} />)</>}. Anyone can retry it.
          </Notice>
        )}

        <Panel>
          <PanelHeader title="People" sub="Full addresses, so you can compare every character." />
          <dl className="mt-3 divide-y divide-line">
            {(
              [
                ['Buyer', deal.buyer],
                ['Seller', deal.seller],
                ['Plug', deal.plug],
                ...(deal.refundTo.toLowerCase() !== deal.buyer.toLowerCase() ? [['Refunds go to', deal.refundTo] as const] : []),
              ] as const
            ).map(([label, addr]) => (
              <div key={label} className="space-y-1 px-5 py-3.5">
                <dt className="text-sm text-muted">{label}</dt>
                <dd>
                  <AddressText address={addr} compact />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Money" />
          <dl className="space-y-2.5 p-5 text-sm">
            <Row label="In escrow" value={<Amount value={split.escrowed} className="font-medium" />} />
            <Row label="Seller gets on payout" value={<Amount value={split.toSeller} />} />
            <Row label="Plug gets on payout" value={<Amount value={split.toPlug} />} />
            <Row label="Buyer gets on refund" value={<Amount value={split.escrowed} />} />
          </dl>
        </Panel>

        <Timeline deal={deal} view={view} now={now} activity={activity} />
      </div>

      <aside className="order-1 space-y-4 lg:sticky lg:top-24 lg:order-none">
        <Actions deal={deal} id={id} view={view} role={role} />
        <div className="flex items-center gap-3 rounded-[16px] border border-line px-4 py-3 text-sm text-muted">
          <span className="min-w-0 flex-1">Share this receipt with the others in the deal.</span>
          <CopyButton value={typeof window !== 'undefined' ? window.location.href : ''} label="Copy receipt link" />
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Progress({ from, to, now }: { from: number; to: number; now: number }) {
  const pct = to <= from ? 100 : Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusHero({ view, deal, role, now }: { view: DealView; deal: Deal; role: Role; now: number }) {
  const left = (t: number) => duration(t - now);
  const copy: Record<string, { title: string; body: React.ReactNode; bar?: [number, number] }> = {
    window: {
      title: `Money-back window closes in ${left(view.windowEndsAt)}`,
      body:
        role === 'buyer'
          ? 'Happy with the work? Release the payment. Something wrong? Open a dispute before the window closes.'
          : role === 'seller'
            ? 'Once the window closes, you can be paid out. The buyer can also release it early.'
            : 'The buyer can still open a dispute until the window closes.',
      bar: [deal.paidAt, deal.releaseAt],
    },
    payable: { title: 'Paying out', body: 'The window closed with no dispute. Plug360 sends the seller and plug their money automatically, usually within a minute.' },
    disputed: {
      title: `The plug has ${left(view.plugDeadline)} to decide`,
      body: role === 'plug' ? 'Hear both sides, then rule: refund the buyer, or reject the dispute so the seller gets paid.' : 'Your plug is looking at it. If they miss the deadline, the buyer gets a full refund.',
      bar: [deal.disputedAt, view.plugDeadline],
    },
    'dispute-expired': { title: 'The plug missed the deadline', body: 'The buyer is owed a full refund. Plug360 sends it automatically, usually within a minute.' },
    released: { title: 'Released to the seller', body: 'Plug360 sends the payout automatically, usually within a minute. It only ever goes to the seller and the plug.' },
    refunded: { title: 'Refunded', body: `The buyer got their money back on ${network.chain.name}.` },
    settled: { title: 'Paid out', body: 'The seller and the plug have been paid. This deal is done.' },
  };
  const c = copy[view.phase];
  if (!c) return null;
  const done = view.phase === 'settled' || view.phase === 'refunded';
  return (
    <div className={cn('space-y-3 rounded-[20px] p-5', done ? 'bg-mint-soft' : view.phase === 'dispute-expired' ? 'bg-danger-soft' : 'bg-raised')}>
      <p className="font-display text-xl font-semibold tracking-tight text-balance">{c.title}</p>
      {c.bar && <Progress from={c.bar[0]} to={c.bar[1]} now={now} />}
      <p className="text-sm leading-relaxed text-muted">{c.body}</p>
    </div>
  );
}

function Actions({ deal, id, view, role }: { deal: Deal; id: bigint; view: DealView; role: Role }) {
  const { address } = useAccount();
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { state, run, recheck, reset, busy } = useTx();
  const [open, setOpen] = useState<ActionId>();
  const [note, setNote] = useState('');
  const idHex = dealIdToHex(id);

  const statusChanged = async () => {
    const d = (await publicClient?.readContract({ address: network.escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [id] })) as Deal | undefined;
    return d !== undefined && (d.status !== deal.status || d.payoutPending !== deal.payoutPending);
  };

  function exec(action: ActionId) {
    const spec = ACTIONS[action];
    const noteHash = keccak256(stringToBytes(note.trim()));
    const args = spec.fn === 'openDispute' || spec.fn === 'plugRefund' || spec.fn === 'plugReject' ? ([id, noteHash] as const) : ([id] as const);
    setOpen(undefined);
    void run({
      label: spec.label,
      dealIdHex: idHex,
      verify: statusChanged,
      onDone: () => setNote(''),
      // Party-only actions get their network fee covered by the gas sponsor when the wallet is short.
      steps: [
        contractStep(
          spec.label,
          { address: network.escrow, abi: dealEscrowAbi, functionName: spec.fn, args },
          SPONSORED.has(spec.fn) ? { sponsor: { dealId: id, action: spec.fn as SponsoredAction } } : {},
        ),
      ],
    });
  }

  const spec = open ? ACTIONS[open] : undefined;

  return (
    <Panel className="space-y-4 p-5">
      <p className="font-display text-lg font-semibold tracking-tight">{view.final ? 'Nothing left to do' : 'What you can do'}</p>
      {!address && !view.final ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Sign in with the email or wallet you used in this deal to see your options.</p>
          <ConnectButton size="lg" />
        </div>
      ) : view.actions.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          {view.final
            ? 'This deal is closed and every payment has gone out.'
            : role === 'viewer'
              ? 'This wallet is not part of the deal. Switch to the buyer, seller or plug wallet to act.'
              : view.phase === 'window' && role === 'plug'
                ? "You'll only be needed if the buyer opens a dispute."
                : 'Nothing for you right now. This page updates on its own.'}
        </p>
      ) : (
        <div className="grid gap-2">
          {view.actions.map((a, i) => (
            <Button key={a} size="lg" variant={i === 0 ? ACTIONS[a].variant : ACTIONS[a].variant === 'primary' ? 'ink' : 'soft'} className="w-full" disabled={busy || state.phase === 'unknown'} onClick={() => setOpen(a)}>
              {ACTIONS[a].label}
            </Button>
          ))}
        </div>
      )}
      <TxStatus state={state} onRecheck={() => recheck({ label: state.label, steps: [], verify: statusChanged })} onDismiss={reset} />

      <Sheet open={!!spec} onClose={() => setOpen(undefined)} title={spec?.confirm ?? ''}>
        {spec && open && (
          <div className="space-y-4">
            <p className="text-[15px] leading-relaxed text-muted">{spec.explain(deal)}</p>
            {spec.note && (
              <Field label={spec.note.label} hint={spec.note.hint}>
                {({ id: fid, describedBy }) => <TextArea id={fid} aria-describedby={describedBy} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            )}
            {spec.irreversible && <p className="text-sm font-medium text-danger-ink">This can&apos;t be undone.</p>}
            <div className="flex flex-col-reverse gap-2 sm:grid sm:grid-cols-2">
              <Button variant="soft" size="lg" onClick={() => setOpen(undefined)}>
                Cancel
              </Button>
              <Button variant={spec.variant === 'soft' ? 'ink' : spec.variant} size="lg" disabled={spec.note?.required && !note.trim()} onClick={() => exec(open)}>
                {spec.label}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </Panel>
  );
}

function Timeline({ deal, view, now, activity }: { deal: Deal; view: DealView; now: number; activity: Activity[] }) {
  type Item = { at: number; title: string; done: boolean; tone?: 'mint' | 'accent' | 'danger' };
  const items: Item[] = [{ at: deal.paidAt, title: 'Paid into escrow', done: true, tone: 'mint' }];
  if (deal.disputedAt > 0) {
    items.push({ at: deal.disputedAt, title: 'Dispute opened', done: true, tone: 'accent' });
    if (!view.final && (view.phase === 'disputed' || view.phase === 'dispute-expired')) items.push({ at: view.plugDeadline, title: 'Plug ruling deadline', done: now >= view.plugDeadline, tone: 'danger' });
  } else if (deal.releaseAt > deal.paidAt && (!view.final || now >= deal.releaseAt)) {
    items.push({ at: deal.releaseAt, title: 'Money-back window closes', done: now >= deal.releaseAt });
  }
  if (view.phase === 'released') items.push({ at: 0, title: 'Released', done: true, tone: 'mint' });
  if (view.phase === 'refunded') items.push({ at: 0, title: 'Refunded to the buyer', done: true, tone: 'mint' });
  if (view.phase === 'settled') items.push({ at: 0, title: 'Paid out to the seller and plug', done: true, tone: 'mint' });

  return (
    <Panel>
      <PanelHeader title="Timeline" />
      <ol className="relative space-y-5 p-5 pl-11">
        <span aria-hidden className="absolute top-7 bottom-7 left-[27px] w-px bg-line-strong" />
        {items.map((it, i) => (
          <li key={i} className="relative">
            <span
              className={cn(
                'absolute top-1 -left-[23px] size-3 rounded-full ring-4 ring-surface',
                !it.done ? 'border-2 border-line-strong bg-surface' : it.tone === 'accent' ? 'bg-accent' : it.tone === 'danger' ? 'bg-danger' : 'bg-mint',
              )}
            />
            <p className={cn('text-sm font-medium', !it.done && 'text-muted')}>{it.title}</p>
            {it.at > 0 && <p className="text-xs text-faint">{dateTime(it.at)}</p>}
          </li>
        ))}
      </ol>
      {activity.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Sent from this browser</p>
          <ul className="space-y-1.5 text-sm">
            {activity.map((a) => (
              <li key={a.hash} className="flex items-center justify-between gap-3">
                <span>{a.label}</span>
                <a href={explorerTx(a.hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-ink">
                  {a.hash.slice(0, 10)}… <ArrowSquareOut className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function ReceiptSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <Skeleton className="h-6 w-32 rounded-full" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-28" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
