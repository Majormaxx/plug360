'use client';

import { Warning } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[plug360] route error', error);
  }, [error]);
  return (
    <EmptyState icon={<Warning className="size-5" />} title="This page hit a problem" action={<Button onClick={reset}>Try again</Button>}>
      No money moved because of this. Reload the page, and if it keeps happening, open the deal from its link again.
      {error.digest && <span className="mt-2 block font-mono text-xs text-faint">Ref {error.digest}</span>}
    </EmptyState>
  );
}
