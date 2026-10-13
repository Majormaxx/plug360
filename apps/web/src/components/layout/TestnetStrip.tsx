import Link from 'next/link';
import { network } from '@/lib/config';

/** Testnet only: nobody should mistake test USDC for real money, or send real USDC here. */
export function TestnetStrip() {
  if (!network.testnet) return null;
  return (
    <div className="bg-ink text-bg dark:bg-raised dark:text-ink">
      <p className="mx-auto max-w-6xl px-4 py-2 text-center text-[13px] sm:px-6">
        You&apos;re on Arc testnet. The USDC here is test money with no value.{' '}
        <Link href="/add-usdc" className="font-medium underline underline-offset-4">
          Get free test USDC
        </Link>
      </p>
    </div>
  );
}
