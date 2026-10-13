import type { Metadata } from 'next';
import { DraftForm } from '@/components/deal/DraftForm';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = { title: 'New deal' };

export default function NewDealPage() {
  return (
    <>
      <PageHeader eyebrow="New deal" title="Set up the deal" sub="Agree the job, the price and who referees. You'll get one link that everyone signs and pays from." />
      <DraftForm />
    </>
  );
}
