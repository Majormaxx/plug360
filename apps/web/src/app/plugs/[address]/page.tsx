import type { Metadata } from 'next';
import { isAddress, getAddress } from 'viem';
import { notFound } from 'next/navigation';
import { PlugCardFull } from '@/components/reputation/PlugCardFull';
import { ButtonLink } from '@/components/ui/Button';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return { title: 'Plug not found' };
  return {
    title: `Plug ${address.slice(0, 6)}…${address.slice(-4)}`,
    description: `Reputation profile for plug ${address} on Plug360.`,
  };
}

export default async function PlugDetailPage({ params }: Props) {
  const { address } = await params;
  if (!isAddress(address)) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <ButtonLink href="/plugs" variant="ghost" size="sm" icon={<ArrowLeft />}>
        All plugs
      </ButtonLink>
      <PlugCardFull address={getAddress(address)} />
    </div>
  );
}
