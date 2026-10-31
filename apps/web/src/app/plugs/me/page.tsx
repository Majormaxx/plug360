'use client';

/**
 * /plugs/me — plug's own dashboard.
 *
 * - If the connected wallet is a listed plug: show their public profile preview
 *   and the live-edit form.
 * - If not connected: prompt to connect.
 * - If connected but not a listed plug: show an informational state.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { isAddressEqual } from 'viem';
import { listedPlugs } from '@/lib/plugs';
import { PlugProfileEditor } from '@/components/reputation/PlugProfileEditor';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Notice } from '@/components/ui/Notice';
import { ButtonLink } from '@/components/ui/Button';

export default function PlugMePage() {
  const { address, isConnected } = useAccount();

  const entry = useMemo(
    () => (address ? listedPlugs.find((p) => isAddressEqual(p.address, address)) : undefined),
    [address],
  );

  /* ── Not connected ────────────────────────────────────────────── */
  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-16 text-center">
        <div className="space-y-2">
          <p className="font-display text-2xl font-semibold tracking-tight">Your plug dashboard</p>
          <p className="text-muted">Connect the wallet you use as a plug to manage your profile.</p>
        </div>
        <ConnectButton size="lg" />
      </div>
    );
  }

  /* ── Connected but not a listed plug ─────────────────────────── */
  if (!entry) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-16 text-center">
        <div className="space-y-2">
          <p className="font-display text-2xl font-semibold tracking-tight">Not a listed plug</p>
          <p className="text-muted">
            This wallet isn&apos;t in the plug directory. If you&apos;d like to become a plug, reach out to the Plug360 team via Telegram.
          </p>
        </div>
        <ButtonLink href="/plugs" variant="soft" size="lg">
          Browse the plug directory
        </ButtonLink>
      </div>
    );
  }

  /* ── Listed plug ──────────────────────────────────────────────── */
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {entry.name}
          </h1>
          <Link
            href={`/plugs/${address}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            View your public page →
          </Link>
        </div>
        <Notice tone="info">
          This is your plug dashboard. What you publish here is what buyers see when they check you before signing a deal.
        </Notice>
      </div>

      <PlugProfileEditor address={address} />
    </div>
  );
}
