'use client';

import { CheckCircle, Circle, Clock, LinkSimple, PaperPlaneTilt, ShareNetwork, XCircle } from '@phosphor-icons/react';
import { acceptTypedData, dealIdOf, DealStatus, termsTypedData, type Terms } from '@plug360/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { isAddressEqual, type Address, type Hex, type PublicClient } from 'viem';
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain } from 'wagmi';
import { useDeal, usePlugLevel } from '@/hooks/useEscrow';
import { useHashState } from '@/hooks/useDraftHash';
import { useNow } from '@/hooks/useNow';
import { escrowDomain, network } from '@/lib/config';
import { claimSeat, decodeDraft, DraftError, encodeDraft, isOpenSeat, reopenSeat, type Draft } from '@/lib/draft';
import { nextActor, type SigState } from '@/lib/dealRoom';
import { signerReadiness } from '@/lib/signers';
import { toFriendlyError } from '@/lib/errors';
import { dateTime, dealIdToHex, duration, usdc } from '@/lib/format';
import { AddressText } from '../ui/AddressText';
import { Amount } from '../ui/Amount';
import { Button, ButtonLink } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/EmptyState';
import { Notice } from '../ui/Notice';
import { Panel, PanelHeader } from '../ui/Panel';
import { Skeleton } from '../ui/Skeleton';
import { ConnectButton } from '../wallet/ConnectButton';
import { FeeBreakdown } from './FeeBreakdown';
import { PayPanel } from './PayPanel';
import { PlugCheck } from './PlugCheck';

/** Verifies on-chain-equivalently: viem's verifier covers plain keys and smart-contract wallets (ERC-1271). */
function useSigState(publicClient: PublicClient | undefined, kind: 'terms' | 'accept', terms: Terms | undefined, sig: Hex | undefined): SigState {
  const q = useQuery({
    queryKey: ['sig', kind, terms?.orderId, terms?.metadataHash, terms?.seller, sig],
    enabled: !!publicClient && !!terms && !!sig,
    staleTime: Infinity,
    retry: 2,
    queryFn: async () => {
      const t = terms!;
      const typed = kind === 'terms' ? termsTypedData(escrowDomain, t) : acceptTypedData(escrowDomain, t);
      return publicClient!.verifyTypedData({ ...typed, address: kind === 'terms' ? t.seller : t.plug, signature: sig! } as never);
    },
  });
  if (!sig) return 'missing';
  if (q.isPending) return 'checking';
  return q.data ? 'valid' : 'invalid';
}

export function DealRoom() {
  const [hash, setHash] = useHashState();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const parsed = useMemo((): { draft?: Draft; error?: DraftError } => {
    if (!hash) return {};
    try {
      return { draft: decodeDraft(hash, escrowDomain) };
    } catch (err) {
      return { error: err instanceof DraftError ? err : new DraftError('malformed', 'This deal link could not be read.') };
    }
  }, [hash]);

  if (!mounted) return <RoomSkeleton />;
  if (!hash) {
    return (
      <EmptyState icon={<LinkSimple className="size-5" />} title="Open a deal link" action={<ButtonLink href="/new">Start a deal</ButtonLink>}>
        Deal links look like plug360…/deal#… and carry the terms with them. Ask whoever sent you here for the full link, or start a new deal.
      </EmptyState>
    );
  }
  if (parsed.error || !parsed.draft) {
    return (
      <EmptyState icon={<XCircle className="size-5" />} title={parsed.error?.reason === 'wrong-network' ? 'Wrong network' : "This link doesn't work"} action={<ButtonLink href="/new" variant="soft">Start a new deal</ButtonLink>}>
        {parsed.error?.message}
      </EmptyState>
    );
  }
  return <Room draft={parsed.draft} onUpdate={(d) => setHash(encodeDraft(d))} />;
}

function Room({ draft, onUpdate }: { draft: Draft; onUpdate: (d: Draft) => void }) {
  const { terms, job } = draft;
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const now = useNow(5_000);

  const dealId = useMemo(() => dealIdOf(terms.seller, terms.orderId), [terms.seller, terms.orderId]);
  const { deal, isLoading: dealLoading } = useDeal(dealId);
  const funded = deal !== undefined && deal.status !== DealStatus.None;

  const sellerSig = useSigState(publicClient, 'terms', terms, draft.sellerSig);
  const plugSig = useSigState(publicClient, 'accept', terms, draft.plugSig);
  const expired = now > 0 && BigInt(now) >= terms.expiry;

  const role: 'seller' | 'plug' | 'buyer' | undefined = !address
    ? undefined
    : isAddressEqual(address, terms.seller)
      ? 'seller'
      : isAddressEqual(address, terms.plug)
        ? 'plug'
        : 'buyer';

  async function sign(kind: 'seller' | 'plug', base: Draft = draft) {
    try {
      if (chainId !== network.chain.id) await switchChainAsync({ chainId: network.chain.id });
      const typed = kind === 'seller' ? termsTypedData(escrowDomain, base.terms) : acceptTypedData(escrowDomain, base.terms);
      const signature = await signTypedDataAsync(typed as never);
      onUpdate(kind === 'seller' ? { ...base, sellerSig: signature } : { ...base, plugSig: signature });
      toast.success(kind === 'seller' ? 'Terms signed' : 'You accepted as the plug', { description: 'Now send the updated link on.' });
    } catch (err) {
      const f = toFriendlyError(err);
      if (f.kind === 'cancelled') toast('Signing cancelled.');
      else toast.error(f.title, f.detail ? { description: f.detail } : undefined);
    }
  }

  const link = typeof window !== 'undefined' ? window.location.href : '';
  const open = isOpenSeat(draft);
  const next = nextActor(open, sellerSig, plugSig);
  const nextUp = next === 'claim' ? 'plug' : next;
  const plugFirst = plugSig === 'valid' && sellerSig !== 'valid';

  // The escrow only accepts smart-wallet signatures once that wallet is deployed (see lib/signers).
  const readiness = useQuery({
    queryKey: ['signer-ready', terms.seller, terms.plug, draft.sellerSig, draft.plugSig],
    enabled: !!publicClient && !!draft.sellerSig && !!draft.plugSig && !open,
    staleTime: 30_000,
    queryFn: async () => {
      const [sc, pc] = await Promise.all([publicClient!.getCode({ address: terms.seller }), publicClient!.getCode({ address: terms.plug })]);
      return { seller: signerReadiness(sc, draft.sellerSig!), plug: signerReadiness(pc, draft.plugSig!) };
    },
  });
  // `deploy` is handled inside payment by the gas sponsor; only a signature nothing can rescue blocks Pay.
  const unusable = readiness.data && (readiness.data.seller === 'unusable' || readiness.data.plug === 'unusable');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <header className="lg:col-span-2 space-y-2">
        <p className="text-sm font-medium text-muted">Deal room</p>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-balance sm:text-4xl">{job.title || 'Untitled deal'}</h1>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Amount value={terms.price} className="font-display text-2xl font-semibold" />
          <span className="text-sm text-muted">
            {terms.windowSeconds === 0 ? 'no money-back window' : `${duration(terms.windowSeconds)} money-back window`}
          </span>
        </p>
      </header>
      <div className="order-2 space-y-6 lg:order-none">

        {funded && (
          <Notice
            tone="success"
            title="This deal is funded"
            action={<ButtonLink href={`/r/${dealIdToHex(dealId)}`} size="sm" variant="ink">Open the receipt</ButtonLink>}
          >
            The money is in escrow. Everything from here happens on the receipt page.
          </Notice>
        )}
        {!funded && expired && <Notice tone="danger" title="This link has expired">Nobody can pay with it any more. The seller can make a new one.</Notice>}
        {(sellerSig === 'invalid' || plugSig === 'invalid') && (
          <Notice tone="danger" title="A signature doesn't match these terms">
            Someone changed the link after it was signed, or signed with a different wallet. Don&apos;t pay with this link; ask for a fresh one.
          </Notice>
        )}

        <Panel>
          <PanelHeader title="Who's involved" sub="Three people, three different wallets. Check each address with the person before you sign or pay." />
          <ol className="mt-4 divide-y divide-line">
            <Seat
              n={1}
              title="Seller"
              blurb="Signs the terms, does the job, gets paid."
              address={terms.seller}
              state={sellerSig}
              doneText="Signed the terms"
              waitText={open || plugFirst ? 'Signs after the plug accepts' : 'Needs to sign'}
              active={nextUp === 'seller'}
            />
            <Seat
              n={2}
              title="Plug"
              blurb="Referees a dispute. Can only refund the buyer or pay the seller."
              address={open ? undefined : terms.plug}
              state={plugSig}
              doneText="Accepted"
              waitText={open ? 'Seat open: your plug adds their wallet' : sellerSig === 'valid' ? 'Needs to accept' : 'Accepts after the seller'}
              active={nextUp === 'plug'}
              extra={open ? undefined : <PlugCheck plug={terms.plug} />}
            />
            <li className={cn('flex gap-4 px-5 py-4', nextUp === 'buyer' && !funded && 'bg-accent-soft/60')}>
              <SeatNumber n={3} state={funded ? 'valid' : 'missing'} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <p className="font-medium">Buyer</p>
                  <span className="text-sm text-muted">{funded ? 'Paid' : nextUp === 'buyer' ? 'Can pay now' : 'Pays last'}</span>
                </div>
                <p className="text-sm text-muted">Whoever pays with this link. Refunds only ever go back to the address they choose when paying.</p>
              </div>
            </li>
          </ol>
        </Panel>

        <Panel>
          <PanelHeader title="Terms" />
          <div className="space-y-4 p-5">
            {job.note ? <p className="whitespace-pre-wrap rounded-[14px] bg-bg p-4 text-[15px] leading-relaxed">{job.note}</p> : <p className="text-sm text-muted">No extra details.</p>}
            <FeeBreakdown price={terms.price} plugFee={terms.plugFee} highlight={role === 'plug' ? 'plug' : role === 'seller' ? 'seller' : 'buyer'} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-[14px] bg-bg p-3">
                <dt className="text-muted">Money-back window</dt>
                <dd className="mt-0.5 font-medium">{terms.windowSeconds === 0 ? 'None' : duration(terms.windowSeconds)}</dd>
              </div>
              <div className="rounded-[14px] bg-bg p-3">
                <dt className="text-muted">Link valid until</dt>
                <dd className="mt-0.5 font-medium">{dateTime(terms.expiry)}</dd>
              </div>
            </dl>
          </div>
        </Panel>
      </div>

      <aside className="order-1 space-y-4 lg:sticky lg:top-24 lg:order-none">
        <Panel className="space-y-4 p-5">
          {dealLoading ? (
            <Skeleton className="h-32" />
          ) : funded ? (
            <ButtonLink href={`/r/${dealIdToHex(dealId)}`} size="lg" className="w-full">Open the receipt</ButtonLink>
          ) : !address ? (
            <div className="space-y-3">
              <p className="font-display text-lg font-semibold tracking-tight">Sign in to continue</p>
              <p className="text-sm text-muted">Use the email or wallet that's part of this deal. The page then shows what you need to do.</p>
              <ConnectButton size="lg" />
            </div>
          ) : open ? (
            role === 'seller' ? (
              <WaitStep text="Send this link to your plug. They add their wallet and accept, then it comes back to you to sign." link={link} />
            ) : (
              <ClaimStep
                account={address}
                price={terms.price}
                loading={signing}
                disabled={expired}
                onClaim={() => sign('plug', claimSeat(draft, address))}
              />
            )
          ) : role === 'seller' ? (
            sellerSig === 'valid' ? (
              <ShareStep title={plugSig === 'valid' ? 'Signed. Now send it to the buyer.' : 'Signed. Now send it to your plug.'} who={plugSig === 'valid' ? 'the buyer' : 'your plug'} link={link} />
            ) : plugFirst ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="font-display text-lg font-semibold tracking-tight">Check your plug, then sign</p>
                  <p className="text-sm text-muted">Someone took the plug seat and accepted. Only sign if this is your plug&apos;s wallet.</p>
                  <div className="rounded-[14px] bg-bg p-3.5">
                    <AddressText address={terms.plug} compact />
                    <div className="mt-2">
                      <PlugCheck plug={terms.plug} />
                    </div>
                  </div>
                </div>
                <Button size="lg" className="w-full" loading={signing} disabled={expired} onClick={() => sign('seller')}>
                  {signing ? 'Check your wallet' : "That's my plug. Sign terms"}
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => (onUpdate(reopenSeat(draft)), toast('Plug seat reopened. Send the link to your plug again.'))}>
                  Not my plug: reopen the seat
                </Button>
              </div>
            ) : (
              <ActionStep
                title="Sign the terms"
                body="Your signature says you agree to do this job for this price, with this plug. It costs nothing and sends no money."
                cta="Sign terms"
                loading={signing}
                disabled={expired}
                onClick={() => sign('seller')}
              />
            )
          ) : role === 'plug' ? (
            plugSig === 'valid' ? (
              sellerSig === 'valid' ? (
                <ShareStep title="Accepted. Send it to the buyer." who="the buyer" link={link} />
              ) : (
                <ShareStep title="Accepted. Send it back to the seller." who="the seller" link={link} />
              )
            ) : sellerSig !== 'valid' ? (
              <WaitStep text="The seller signs first. You'll get the link after that." />
            ) : (
              <ActionStep
                title="Accept as the plug"
                body="You agree to referee if there's a dispute. If you're asked to rule, you'll have 7 days. You can refund the buyer or pay the seller, nothing else."
                cta="Accept"
                loading={signing}
                disabled={expired}
                onClick={() => sign('plug')}
              />
            )
          ) : nextUp !== 'buyer' ? (
            <WaitStep text={nextUp === 'seller' ? 'Waiting for the seller to sign. Send them this link.' : 'Waiting for the plug to accept. Send them this link.'} link={link} />
          ) : unusable ? (
            <Notice tone="warn" title={`The ${readiness.data?.seller === 'unusable' ? 'seller' : 'plug'} needs to sign again`}>
              Their wallet signed in a way the escrow can&apos;t check. Ask them to open the link and sign once more; it takes a few seconds.
            </Notice>
          ) : (
            <PayPanel draft={draft} dealId={dealId} disabled={expired || sellerSig !== 'valid' || plugSig !== 'valid' || readiness.isLoading} />
          )}
        </Panel>
        {!funded && <ShareRow link={link} />}
      </aside>
    </div>
  );
}

function SeatNumber({ n, state }: { n: number; state: SigState }) {
  if (state === 'valid') return <CheckCircle weight="fill" className="mt-0.5 size-6 shrink-0 text-mint" />;
  if (state === 'invalid') return <XCircle weight="fill" className="mt-0.5 size-6 shrink-0 text-danger" />;
  if (state === 'checking') return <Clock className="mt-0.5 size-6 shrink-0 text-muted" />;
  return (
    <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
      <Circle className="absolute size-6 text-line-strong" />
      <span className="text-xs font-semibold text-muted">{n}</span>
    </span>
  );
}

function Seat(props: { n: number; title: string; blurb: string; address: Address | undefined; state: SigState; doneText: string; waitText: string; active: boolean; extra?: React.ReactNode }) {
  const status = props.state === 'valid' ? props.doneText : props.state === 'invalid' ? "Signature doesn't match" : props.state === 'checking' ? 'Checking signature' : props.waitText;
  return (
    <li className={cn('flex gap-4 px-5 py-4', props.active && 'bg-accent-soft/60')}>
      <SeatNumber n={props.n} state={props.state} />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <div className="flex flex-wrap items-center gap-x-2">
            <p className="font-medium">{props.title}</p>
            <span className={cn('text-sm', props.state === 'valid' ? 'text-mint-ink' : props.state === 'invalid' ? 'text-danger-ink' : 'text-muted')}>{status}</span>
          </div>
          <p className="text-sm text-muted">{props.blurb}</p>
        </div>
        {props.address && <AddressText address={props.address} compact />}
        {props.extra}
      </div>
    </li>
  );
}

function ActionStep({ title, body, cta, onClick, loading, disabled }: { title: string; body: string; cta: string; onClick: () => void; loading: boolean; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
      <Button size="lg" className="w-full" onClick={onClick} loading={loading} disabled={disabled}>
        {loading ? 'Check your wallet' : cta}
      </Button>
    </div>
  );
}

function ClaimStep({ account, price, loading, disabled, onClaim }: { account: Address; price: bigint; loading: boolean; disabled: boolean; onClaim: () => void }) {
  const { level, cap, isLoading } = usePlugLevel(account);
  if (isLoading || level === undefined) return <Skeleton className="h-32" />;
  if (level === 0) {
    return (
      <div className="space-y-3">
        <p className="font-display text-lg font-semibold tracking-tight">Are you the plug?</p>
        <Notice tone="warn" title="This wallet isn't a listed plug yet">
          Plugs are listed one at a time while the contract is new. Ask to be listed, or connect the wallet that is.
        </Notice>
        <ButtonLink href="/#plugs" variant="soft" className="w-full">How to become a plug</ButtonLink>
      </div>
    );
  }
  const tooBig = cap !== undefined && price > cap;
  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold tracking-tight">Be the plug for this deal</p>
      <p className="text-sm leading-relaxed text-muted">
        You&apos;ll be the referee if there&apos;s a dispute, with 7 days to rule. Taking the seat adds this wallet to the deal and signs your acceptance in one step.
      </p>
      {tooBig ? (
        <Notice tone="warn" title="This deal is over your limit">A level {level} plug can referee up to {usdc(cap!)} USDC.</Notice>
      ) : (
        <Button size="lg" className="w-full" loading={loading} disabled={disabled} onClick={onClaim}>
          {loading ? 'Check your wallet' : 'Be the plug'}
        </Button>
      )}
    </div>
  );
}

function ShareStep({ title, who, link }: { title: string; who: string; link: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle weight="fill" className="size-5 text-mint" />
        <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
      </div>
      <p className="text-sm text-muted">The link now includes your signature. Send the whole link to {who}; anything cut off won&apos;t work.</p>
      <ShareButtons link={link} />
    </div>
  );
}

function WaitStep({ text, link }: { text: string; link?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="size-5 text-muted" />
        <p className="font-display text-lg font-semibold tracking-tight">Not your turn yet</p>
      </div>
      <p className="text-sm text-muted">{text}</p>
      {link && <ShareButtons link={link} />}
    </div>
  );
}

function ShareButtons({ link }: { link: string }) {
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="grid grid-cols-2 gap-2">
      {canShare && (
        <Button
          variant="ink"
          icon={<ShareNetwork weight="bold" className="size-4" />}
          onClick={() => navigator.share({ title: 'Plug360 deal', text: 'Here is our deal on Plug360:', url: link }).catch(() => {})}
        >
          Share
        </Button>
      )}
      <CopyButton value={link} label="Copy deal link" className={cn('h-11 justify-center rounded-full bg-raised px-4 font-medium text-ink', !canShare && 'col-span-2')}>
        Copy link
      </CopyButton>
    </div>
  );
}

function ShareRow({ link }: { link: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-line px-4 py-3 text-sm text-muted">
      <PaperPlaneTilt className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">Everyone uses this same link. It updates as people sign.</span>
      <CopyButton value={link} label="Copy deal link" />
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}
