'use client';

import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';

type Option<T extends string | number> = { value: T; label: ReactNode; disabled?: boolean };

/** A row of mutually exclusive choices with a sliding thumb. Arrow keys move between options. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const layoutId = useId();
  const move = (dir: 1 | -1) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-raised p-1', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1));
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'press relative isolate whitespace-nowrap rounded-full px-3 font-medium transition-colors duration-150 disabled:opacity-40',
              size === 'sm' ? 'h-8 text-[13px]' : 'h-10 text-sm',
              active ? 'text-bg' : 'text-muted hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-full bg-ink"
                transition={{ type: 'spring', duration: 0.3, bounce: 0.12 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
