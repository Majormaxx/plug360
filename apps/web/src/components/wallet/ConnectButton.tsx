'use client';

import { CaretDown, SignIn, SignOut, Wallet } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, type Connector } from 'wagmi';
import { network } from '@/lib/config';
import { shortAddress } from '@/lib/format';
import { toFriendlyError } from '@/lib/errors';
import { useUsdc } from '@/hooks/useEscrow';
import { AddressText } from '../ui/AddressText';
import { Amount } from '../ui/Amount';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ThemeToggle } from '../layout/ThemeToggle';
import { toast } from 'sonner';
import type { PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle/connector';
import { circleEnabled } from '@/lib/circle/config';
import { activate, loginErrorMessage } from '@/lib/circle/login';
import { warmCircle } from '@/lib/circle/sdk';
import { displayName, loadSession, onSessionChange } from '@/lib/circle/session';
import { CircleSignIn } from './CircleSignIn';

/** Wallets announced through EIP-6963 replace the generic injected entry, so each shows once by name. */
function visibleConnectors(connectors: readonly Connector[]) {
  const wallets = connectors.filter((c) => c.id !== CIRCLE_CONNECTOR_ID);
  const named = wallets.filter((c) => c.id !== 'injected');
  return named.length > 0 ? named : wallets;
}

/** Opens sign-in. With Circle configured it reads "Sign in", since most people arrive without a wallet app. */
export function ConnectButton({ size = 'sm', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  label ??= circleEnabled ? 'Sign in' : size === 'sm' ? 'Connect' : 'Connect wallet';
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { address, status, connector } = useAccount();
  useEffect(() => setMounted(true), []);
  // Google sign-ins show the person's first name; the address lives in the account sheet.
  const [person, setPerson] = useState<{ name: string; initial: string }>();
  useEffect(() => {
    const read = () => {
      const s = loadSession();
      const name = connector?.id === CIRCLE_CONNECTOR_ID && s && address && s.address.toLowerCase() === address.toLowerCase() ? displayName(s) : undefined;
      setPerson(name ? { name, initial: name[0]!.toUpperCase() } : undefined);
    };
    read();
    return onSessionChange(read);
  }, [address, connector]);

  if (!mounted || status === 'reconnecting') return <Skeleton className="h-9 w-28 rounded-full" />;

  return (
    <>
      {address ? (
        <Button
          variant="soft"
          size={size}
          onClick={() => setOpen(true)}
          aria-label={person ? `${person.name}, account ${shortAddress(address)}` : undefined}
          icon={
            person ? (
              <span aria-hidden className="grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-ink">
                {person.initial}
              </span>
            ) : (
              <span className="size-2 rounded-full bg-mint" />
            )
          }
        >
          {person ? <span className="max-w-[10rem] truncate">{person.name}</span> : <span className="tabular">{shortAddress(address)}</span>}
        </Button>
      ) : (
        <Button
          variant="ink"
          size={size}
          onClick={() => {
            if (circleEnabled) warmCircle();
            setOpen(true);
          }} icon={circleEnabled ? <SignIn weight="bold" className="size-4" /> : <Wallet weight="bold" className="size-4" />}>
          {label}
        </Button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={address ? 'Your wallet' : circleEnabled ? 'Sign in' : 'Connect a wallet'}>
        {address ? <AccountPanel address={address} onDone={() => setOpen(false)} /> : <ConnectPanel onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

function ConnectPanel({ onDone }: { onDone: () => void }) {
  const { connectors, connectAsync } = useConnect();
  // Which wallet we are waiting on. Kept apart from wagmi's isPending so a wallet that never answers
  // (locked, or Talisman before its setup is finished) cannot lock every other button.
  const [waiting, setWaiting] = useState<string>();
  const list = visibleConnectors(connectors);
  const hasInjected = typeof window !== 'undefined' && 'ethereum' in window;
  const here = typeof window !== 'undefined' ? window.location.href.replace(/^https?:\/\//, '') : '';
  // With email or Google sign-in available, wallet apps are the secondary path and start folded away.
  const [showWallets, setShowWallets] = useState(!circleEnabled);
  const openWallets = useCallback(() => setShowWallets(true), []);

  return (
    <div className="space-y-4">
      {circleEnabled && (
        <>
          <CircleSignIn onDone={onDone} onBlocked={openWallets} />
          <button type="button" aria-expanded={showWallets} onClick={() => setShowWallets((v) => !v)} className="press flex w-full items-center gap-3 text-xs text-faint hover:text-muted">
            <span className="h-px flex-1 bg-line" />
            <span className="inline-flex items-center gap-1">
              I already have a crypto wallet <CaretDown className={`size-3 transition-transform duration-200 ${showWallets ? 'rotate-180' : ''}`} />
            </span>
            <span className="h-px flex-1 bg-line" />
          </button>
        </>
      )}
      {!showWallets ? null : hasInjected || list.some((c) => c.id !== 'injected') ? (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.uid}>
              <button
                type="button"
                onClick={async () => {
                  const name = c.id === 'injected' ? 'Your wallet' : c.name;
                  setWaiting(c.uid);
                  const nudge = setTimeout(() => {
                    setWaiting((w) => (w === c.uid ? undefined : w));
                    toast(`${name} didn't respond.`, { description: 'Open it from your browser toolbar to unlock it or finish setting it up, then try again. Or pick another wallet.' });
                  }, 20_000);
                  try {
                    await connectAsync({ connector: c, chainId: network.chain.id });
                    onDone();
                  } catch (err) {
                    const code = (err as { code?: number; cause?: { code?: number } }).code ?? (err as { cause?: { code?: number } }).cause?.code;
                    const f = toFriendlyError(err);
                    if (code === -32002) toast.error(`${name} already has a request open.`, { description: 'Click its icon in your browser toolbar to finish or reject it, then try again.' });
                    else if (f.kind === 'cancelled') toast('Connection cancelled.');
                    else toast.error("Couldn't connect.", { description: f.detail ?? f.title });
                  } finally {
                    clearTimeout(nudge);
                    setWaiting((w) => (w === c.uid ? undefined : w));
                  }
                }}
                className="press flex w-full items-center gap-3 rounded-[16px] border border-line bg-bg px-4 py-3.5 text-left transition-colors hover:border-line-strong disabled:opacity-60"
              >
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="size-8 rounded-lg" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-lg bg-raised">
                    <Wallet className="size-4" />
                  </span>
                )}
                <span className="flex-1 font-medium">{c.id === 'injected' ? 'Browser wallet' : c.name}</span>
                {waiting === c.uid && <span className="text-sm text-muted">Check your wallet</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : circleEnabled ? (
        <p className="text-center text-sm text-muted">
          Have a wallet app?{' '}
          <a className="font-medium text-ink underline underline-offset-4" href={`https://metamask.app.link/dapp/${here}`}>
            Open in MetaMask
          </a>{' '}
          or{' '}
          <a className="font-medium text-ink underline underline-offset-4" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(`https://${here}`)}`}>
            Coinbase Wallet
          </a>
        </p>
      ) : (
        <div className="space-y-3">
          <Notice title="No wallet found in this browser">
            On a phone, open this page inside your wallet app&apos;s browser. On a computer, install a wallet extension such as Rabby or MetaMask.
          </Notice>
          <div className="grid gap-2">
            <a className="press rounded-[16px] border border-line bg-bg px-4 py-3.5 font-medium" href={`https://metamask.app.link/dapp/${here}`}>
              Open in MetaMask
            </a>
            <a className="press rounded-[16px] border border-line bg-bg px-4 py-3.5 font-medium" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(`https://${here}`)}`}>
              Open in Coinbase Wallet
            </a>
          </div>
        </div>
      )}
      {showWallets && (
        <p className="text-xs leading-relaxed text-muted">
          Plug360 never holds your keys. Your wallet asks before anything is signed or sent, and every payment goes straight to the escrow contract.
        </p>
      )}
    </div>
  );
}

function AccountPanel({ address, onDone }: { address: `0x${string}`; onDone: () => void }) {
  const { disconnect } = useDisconnect();
  const { connector } = useAccount();
  const { balance, isLoading } = useUsdc(address);
  const isCircle = connector?.id === CIRCLE_CONNECTOR_ID;
  const publicClient = usePublicClient() as PublicClient | undefined;
  const code = useQuery({
    queryKey: ['code', address],
    enabled: isCircle && !!publicClient,
    queryFn: () => publicClient!.getCode({ address }),
  });
  const [activating, setActivating] = useState(false);
  const inactive = isCircle && code.isSuccess && (!code.data || code.data === '0x');
  return (
    <div className="space-y-5">
      <div className="rounded-[16px] bg-bg p-4">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">{isCircle ? (loadSession()?.email ?? 'Signed in with Circle') : (connector?.name ?? 'Wallet')}</p>
        <AddressText address={address} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">USDC balance</span>
        {isLoading || balance === undefined ? <Skeleton className="h-5 w-20" /> : <Amount value={balance} className="font-medium" />}
      </div>
      {inactive && (
        <Notice
          tone="warn"
          title="Activate your wallet"
          action={
            <Button
              size="sm"
              variant="ink"
              loading={activating}
              onClick={async () => {
                const s = loadSession();
                if (!s || !publicClient) return;
                setActivating(true);
                try {
                  await activate(s, publicClient);
                  await code.refetch();
                  toast.success('Wallet activated');
                } catch (err) {
                  toast.error(loginErrorMessage(err));
                } finally {
                  setActivating(false);
                }
              }}
            >
              Activate
            </Button>
          }
        >
          One approval puts your wallet on-chain so others can check your signature when you sell or referee.
        </Notice>
      )}
      <div className="space-y-2">
        <span className="text-sm text-muted">Appearance</span>
        <ThemeToggle />
      </div>
      <Button
        variant="soft"
        className="w-full"
        icon={<SignOut className="size-4" />}
        onClick={() => {
          disconnect();
          onDone();
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}
