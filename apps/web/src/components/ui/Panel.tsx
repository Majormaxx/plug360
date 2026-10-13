import type { ComponentProps } from 'react';
import { cn } from './cn';

export function Panel({ className, ...rest }: ComponentProps<'section'>) {
  return <section {...rest} className={cn('rounded-[20px] border border-line bg-surface shadow-card', className)} />;
}

export function PanelHeader({ title, aside, sub }: { title: string; aside?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}
