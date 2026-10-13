import { CheckCircle, Info, WarningCircle, XCircle } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { cn } from './cn';

type Tone = 'info' | 'success' | 'warn' | 'danger';
const styles: Record<Tone, { box: string; Icon: typeof Info }> = {
  info: { box: 'bg-raised text-ink', Icon: Info },
  success: { box: 'bg-mint-soft text-ink', Icon: CheckCircle },
  warn: { box: 'bg-gold-soft text-ink', Icon: WarningCircle },
  danger: { box: 'bg-danger-soft text-ink', Icon: XCircle },
};
const iconTone: Record<Tone, string> = {
  info: 'text-muted',
  success: 'text-mint-ink',
  warn: 'text-gold-ink',
  danger: 'text-danger-ink',
};

export function Notice({ tone = 'info', title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { box, Icon } = styles[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-[16px] p-3.5 text-sm', box, className)}>
      <Icon weight="fill" className={cn('mt-0.5 size-[18px] shrink-0', iconTone[tone])} />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium leading-snug">{title}</p>}
        {children && <div className="leading-relaxed text-muted">{children}</div>}
        {action && <div className="pt-1.5">{action}</div>}
      </div>
    </div>
  );
}
