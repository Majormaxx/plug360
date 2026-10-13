import type { Metadata } from 'next';
import { MyDeals } from '@/components/deal/MyDeals';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = { title: 'My deals' };

export default function MyDealsPage() {
  return (
    <>
      <PageHeader title="My deals" sub="Every funded deal this wallet is part of, read straight from the escrow contract." />
      <MyDeals />
    </>
  );
}
