import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[20px] border border-dashed border-line-strong px-6 py-12 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-raised text-muted">{icon}</div>
      <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
