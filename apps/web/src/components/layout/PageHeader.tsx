import type { ReactNode } from 'react';

export function PageHeader({ title, sub, eyebrow }: { title: string; sub?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 space-y-2 md:mb-8">
      {eyebrow && <p className="text-sm font-medium text-muted">{eyebrow}</p>}
      <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-balance md:text-4xl">{title}</h1>
      {sub && <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted">{sub}</p>}
    </header>
  );
}
