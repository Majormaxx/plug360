'use client';

import { X } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Native <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="sheet border border-line bg-surface p-0 text-ink shadow-card"
      aria-label={title}
    >
      <div className="pb-safe">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center justify-between px-5 pt-4 sm:pt-5">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="press -mr-2 rounded-full p-2 text-muted hover:bg-raised hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-5 pt-3 pb-5">{children}</div>
      </div>
    </dialog>
  );
}
