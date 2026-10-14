'use client';

import { ArrowSquareOut, Drop, GasPump, Bank } from '@phosphor-icons/react';
import { useAccount } from 'wagmi';
import { useUsdc } from '@/hooks/useEscrow';
import { network } from '@/lib/config';
import { AddressText } from '../ui/AddressText';
import { Amount } from '../ui/Amount';
import { Notice } from '../ui/Notice';
import { Panel } from '../ui/Panel';
import { Skeleton } from '../ui/Skeleton';
import { ConnectButton } from '../wallet/ConnectButton';

const EXCHANGES = ['Kraken', 'OKX', 'Bybit', 'Bitget', 'KuCoin'];

export function AddUsdc() {
  const { address } = useAccount();
  const { balance, isLoading } = useUsdc(address);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="space-y-4">
        {network.testnet ? (
          <Step n={1} icon={<Drop className="size-5" />} title="Get free test USDC">
            <p>This is the Arc testnet, so the money isn&apos;t real. Circle&apos;s faucet sends test USDC to any address.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Copy your address from the panel.</li>
              <li>Open the faucet, pick Arc Testnet and paste it.</li>
              <li>Come back here. Your balance updates on its own.</li>
            </ol>
            <a href={network.faucet} target="_blank" rel="noreferrer" className="press mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 font-medium text-bg">
              Open the faucet <ArrowSquareOut className="size-4" />
            </a>
          </Step>
        ) : (
          <Step n={1} icon={<Bank className="size-5" />} title="Withdraw USDC on the Arc network">
            <p>Buy USDC on an exchange that supports Arc withdrawals, then withdraw it to your address and choose Arc as the network.</p>
            <p>Exchanges that support it today: {EXCHANGES.join(', ')}.</p>
            <Notice tone="warn" title="Pick the Arc network">Sending USDC over a different network to this address won&apos;t arrive on Arc.</Notice>
          </Step>
        )}
        <Step n={2} icon={<GasPump className="size-5" />} title="Keep a little extra for gas">
          <p>Gas on Arc is paid in USDC too, so there&apos;s no second token to buy. Each action costs a fraction of a cent; 0.10 USDC of headroom covers many deals.</p>
        </Step>
      </div>

      <aside className="lg:sticky lg:top-24">
        <Panel className="space-y-4 p-5">
          <p className="font-display text-lg font-semibold tracking-tight">Your wallet</p>
          {address ? (
            <>
              <div className="rounded-[14px] bg-bg p-3.5">
                <AddressText address={address} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Balance</span>
                {isLoading || balance === undefined ? <Skeleton className="h-6 w-24" /> : <Amount value={balance} className="font-display text-xl font-semibold" />}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Sign in to see your address and balance.</p>
              <ConnectButton size="lg" />
            </>
          )}
        </Panel>
      </aside>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Panel className="flex gap-4 p-5 sm:p-6">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-muted" aria-hidden>
        {icon}
      </div>
      <div className="min-w-0 space-y-2 text-[15px] leading-relaxed text-muted">
        <p className="text-xs font-medium uppercase tracking-wider text-faint">Step {n}</p>
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {children}
      </div>
    </Panel>
  );
}
