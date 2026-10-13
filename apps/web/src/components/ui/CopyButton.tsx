'use client';

import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from './cn';

export function CopyButton({ value, label = 'Copy', className, children }: { value: string; label?: string; className?: string; children?: React.ReactNode }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1_600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
        } catch {
          toast.error("Couldn't copy. Select the text and copy it by hand.");
        }
      }}
      className={cn('press inline-flex items-center gap-1.5 rounded-full text-muted transition-colors hover:text-ink', className)}
    >
      <span className="relative size-4">
        <Copy className={cn('absolute inset-0 size-4 transition-[opacity,transform] duration-150', done && 'scale-75 opacity-0')} />
        <Check weight="bold" className={cn('absolute inset-0 size-4 text-mint-ink transition-[opacity,transform] duration-150', !done && 'scale-75 opacity-0')} />
      </span>
      {children}
      <span className="sr-only" aria-live="polite">
        {done ? 'Copied' : ''}
      </span>
    </button>
  );
}
