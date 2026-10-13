import type { Metadata } from 'next';
import { AddUsdc } from '@/components/landing/AddUsdc';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = { title: 'Add USDC' };

export default function AddUsdcPage() {
  return (
    <>
      <PageHeader title="Add USDC" sub="Deals on Plug360 are paid in USDC on Arc. Here's how to get some into your wallet." />
      <AddUsdc />
    </>
  );
}
