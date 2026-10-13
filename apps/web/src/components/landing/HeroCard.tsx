'use client';

import { CheckCircle, SealCheck } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';

/** A static picture of a live deal, drawn with the app's own styles so the landing shows the real product. */
export function HeroCard() {
  const reduce = useReducedMotion();
  const enter = (delay: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, transform: 'translateY(12px)' }, animate: { opacity: 1, transform: 'translateY(0px)' }, transition: { duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] as const } };

  return (
    <div className="relative mx-auto w-full max-w-[400px] lg:mr-0">
      <div aria-hidden className="absolute inset-x-6 -bottom-3 top-6 rounded-[24px] border border-line bg-raised" />
      <motion.div {...enter(0.05)} className="relative space-y-5 rounded-[24px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-raised px-2.5 text-xs font-medium text-muted">
            <span className="size-1.5 rounded-full bg-accent" /> Window open
          </span>
          <span className="text-xs text-faint">closes in 2 days</span>
        </div>
        <div>
          <p className="font-display text-xl font-semibold tracking-tight">Logo for Ada&apos;s bakery</p>
          <p className="tabular mt-1 font-display text-3xl font-semibold">
            25.00<span className="ml-1.5 text-base font-medium text-muted">USDC</span>
          </p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full w-[38%] rounded-full bg-accent" />
        </div>
        <ul className="space-y-3">
          {[
            { who: 'Tobi', role: 'Seller', note: 'signed the terms' },
            { who: 'Kemi', role: 'Plug', note: 'accepted', badge: true },
            { who: 'Ada', role: 'Buyer', note: 'paid 25.25' },
          ].map((p, i) => (
            <motion.li key={p.who} {...enter(0.2 + i * 0.08)} className="flex items-center gap-3">
              <CheckCircle weight="fill" className="size-5 shrink-0 text-mint" />
              <span className="text-sm">
                <span className="font-medium">{p.who}</span> <span className="text-muted">· {p.role} · {p.note}</span>
              </span>
              {p.badge && (
                <span className="ml-auto inline-flex h-6 items-center gap-1 rounded-full bg-gold-soft px-2 text-[11px] font-medium text-gold-ink">
                  <SealCheck weight="fill" className="size-3.5" /> Level 3
                </span>
              )}
            </motion.li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <span className="grid h-11 place-items-center rounded-full bg-accent text-sm font-medium text-accent-ink">Release payment</span>
          <span className="grid h-11 place-items-center rounded-full bg-raised text-sm font-medium">Open a dispute</span>
        </div>
      </motion.div>
    </div>
  );
}
