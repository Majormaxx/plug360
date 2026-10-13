'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'ink' | 'soft' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-[1.04] shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]',
  ink: 'bg-ink text-bg hover:opacity-90',
  soft: 'bg-raised text-ink hover:bg-line-strong/60',
  ghost: 'text-ink hover:bg-raised',
  danger: 'bg-danger text-white hover:brightness-110',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-14 px-6 text-base gap-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(
    'press inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium',
    'transition-[background-color,opacity,filter,transform] duration-150 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-45',
    variants[variant],
    sizes[size],
    className,
  );
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant, size, loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  icon,
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      style={{ animationDuration: '600ms' }}
    />
  );
}
