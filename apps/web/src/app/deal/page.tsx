import type { Metadata } from 'next';
import { DealRoom } from '@/components/deal/DealRoom';

export const metadata: Metadata = { title: 'Deal room', robots: { index: false } };

export default function DealPage() {
  return <DealRoom />;
}
