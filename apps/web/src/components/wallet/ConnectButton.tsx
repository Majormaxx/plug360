'use client';

import { SignOut, Wallet } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
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

/** Wallets announced through EIP-6963 replace the generic injected entry, so each shows once by name. */
function visibleConnectors(connectors: readonly Connector[]) {
  const named = connectors.filter((c) => c.id !== 'injected');
  return named.length > 0 ? named : connectors;
}

export function ConnectButton({ size = 'sm', label = 'Connect' }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { address, status } = useAccount();
  useEffect(() => setMounted(true), []);

  if (!mounted || status === 'reconnecting') return <Skeleton className="h-9 w-28 rounded-full" />;

  return (
    <>
      {address ? (
        <Button variant="soft" size={size} onClick={() => setOpen(true)} icon={<span className="size-2 rounded-full bg-mint" />}>
          <span className="tabular">{shortAddress(address)}</span>
        </Button>
      ) : (
        <Button variant="ink" size={size} onClick={() => setOpen(true)} icon={<Wallet weight="bold" className="size-4" />}>
          {label}
        </Button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={address ? 'Your wallet' : 'Connect a wallet'}>
        {address ? <AccountPanel address={address} onDone={() => setOpen(false)} /> : <ConnectPanel onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

function ConnectPanel({ onDone }: { onDone: () => void }) {
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const list = visibleConnectors(connectors);
  const hasInjected = typeof window !== 'undefined' && 'ethereum' in window;
  const here = typeof window !== 'undefined' ? window.location.href.replace(/^https?:\/\//, '') : '';

  return (
    <div className="space-y-4">
      {hasInjected || list.some((c) => c.id !== 'injected') ? (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.uid}>
              <button
                type="button"
                disabled={isPending}
                onClick={async () => {
                  try {
                    await connectAsync({ connector: c, chainId: network.chain.id });
                    onDone();
                  } catch (err) {
                    const f = toFriendlyError(err);
                    if (f.kind === 'cancelled') toast('Connection cancelled.');
                    else toast.error("Couldn't connect.", { description: f.detail ?? f.title });
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
                {isPending && variables?.connector === c && <span className="text-sm text-muted">Check your wallet</span>}
              </button>
            </li>
          ))}
        </ul>
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
      <p className="text-xs leading-relaxed text-muted">
        Plug360 never holds your keys. Your wallet asks before anything is signed or sent, and every payment goes straight to the escrow contract.
      </p>
    </div>
  );
}

function AccountPanel({ address, onDone }: { address: `0x${string}`; onDone: () => void }) {
  const { disconnect } = useDisconnect();
  const { connector } = useAccount();
  const { balance, isLoading } = useUsdc(address);
  return (
    <div className="space-y-5">
      <div className="rounded-[16px] bg-bg p-4">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">{connector?.name ?? 'Wallet'}</p>
        <AddressText address={address} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">USDC balance</span>
        {isLoading || balance === undefined ? <Skeleton className="h-5 w-20" /> : <Amount value={balance} className="font-medium" />}
      </div>
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
