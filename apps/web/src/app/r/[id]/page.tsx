import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Receipt } from '@/components/deal/Receipt';
import { parseDealId } from '@/lib/format';

export const metadata: Metadata = { title: 'Receipt', robots: { index: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dealId = parseDealId(id);
  if (dealId === undefined) notFound();
  return <Receipt id={dealId} />;
}
