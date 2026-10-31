import type { Metadata } from 'next';
import { PlugDirectory } from '@/components/reputation/PlugDirectory';

export const metadata: Metadata = {
  title: 'Plug directory',
  description: 'Find a trusted plug to referee your deal on Plug360.',
};

export default function PlugsPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Plug directory</h1>
        <p className="text-muted max-w-xl">
          A plug is the mutual friend who settles any dispute. Every stat below is computed from on-chain events —
          nobody can fake a ruling history.
        </p>
      </div>
      <PlugDirectory />
    </div>
  );
}
