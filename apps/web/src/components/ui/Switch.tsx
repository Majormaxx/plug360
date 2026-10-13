'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from './cn';

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-out disabled:opacity-40',
          checked ? 'bg-ink' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full bg-bg shadow transition-transform duration-200 ease-[var(--ease-out)]',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
