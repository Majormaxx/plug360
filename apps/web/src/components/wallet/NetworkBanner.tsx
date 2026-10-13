'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { network } from '@/lib/config';
import { toFriendlyError } from '@/lib/errors';
import { Button } from '../ui/Button';
import { toast } from 'sonner';

/** Shown while the connected wallet sits on another chain. Switching adds Arc to the wallet if needed. */
export function NetworkBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  if (!isConnected || chainId === network.chain.id) return null;
  return (
    <div className="border-b border-line bg-gold-soft">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <p className="text-sm">
          Your wallet is on another network. Plug360 runs on <strong className="font-medium">{network.chain.name}</strong>.
        </p>
        <Button
          size="sm"
          variant="ink"
          loading={isPending}
          onClick={() =>
            switchChainAsync({ chainId: network.chain.id }).catch((err) => toast.error(toFriendlyError(err).title))
          }
        >
          Switch
        </Button>
      </div>
    </div>
  );
}
