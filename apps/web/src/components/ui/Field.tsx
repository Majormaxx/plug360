import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from './cn';

type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  aside?: ReactNode;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
};

/** Label, control, hint and error wired together for screen readers. */
export function Field({ label, hint, error, aside, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {aside}
      </div>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errId} className="text-sm text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const control =
  'w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 focus:border-ink focus:outline-none focus:ring-4 focus:ring-accent-soft aria-[invalid=true]:border-danger';

export function Input({ className, leading, trailing, ...rest }: ComponentProps<'input'> & { leading?: ReactNode; trailing?: ReactNode }) {
  if (!leading && !trailing) return <input {...rest} className={cn(control, 'h-12', className)} />;
  return (
    <div className="relative">
      {leading && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">{leading}</span>}
      <input {...rest} className={cn(control, 'h-12', leading && 'pl-10', trailing && 'pr-16', className)} />
      {trailing && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted">{trailing}</span>}
    </div>
  );
}

export function TextArea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea {...rest} className={cn(control, 'min-h-24 resize-y py-3 leading-relaxed', className)} />;
}
