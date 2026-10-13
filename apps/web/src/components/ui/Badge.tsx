import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'accent' | 'mint' | 'gold' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-raised text-muted',
  accent: 'bg-accent-soft text-ink',
  mint: 'bg-mint-soft text-mint-ink',
  gold: 'bg-gold-soft text-gold-ink',
  danger: 'bg-danger-soft text-danger-ink',
};
const dots: Record<Tone, string> = {
  neutral: 'bg-faint',
  accent: 'bg-accent',
  mint: 'bg-mint',
  gold: 'bg-gold',
  danger: 'bg-danger',
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', tones[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}
