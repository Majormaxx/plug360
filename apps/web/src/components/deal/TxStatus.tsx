'use client';

import { ArrowSquareOut, ArrowsClockwise } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { explorerTx } from '@/lib/config';
import type { TxState } from '@/lib/tx';
import { Button, Spinner } from '../ui/Button';
import { Notice } from '../ui/Notice';

const PHASE_TEXT: Partial<Record<TxState['phase'], string>> = {
  checking: 'Checking with Arc',
  wallet: 'Confirm in your wallet',
  pending: 'Waiting for Arc to confirm',
};

/** Inline progress for the current action, so feedback sits next to the button that started it. */
export function TxStatus({ state, onRecheck, onDismiss }: { state: TxState; onRecheck?: () => void; onDismiss?: () => void }) {
  const text = PHASE_TEXT[state.phase];
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {text && (
        <motion.div
          key="busy"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          role="status"
          className="flex items-center gap-3 rounded-[16px] bg-raised px-4 py-3 text-sm"
        >
          <Spinner className="text-muted" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{text}</p>
            {state.steps > 1 && (
              <p className="text-muted">
                Step {state.step} of {state.steps}
              </p>
            )}
          </div>
          {state.hash && (
            <a href={explorerTx(state.hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-ink">
              View <ArrowSquareOut className="size-3.5" />
            </a>
          )}
        </motion.div>
      )}
      {state.phase === 'unknown' && (
        <motion.div key="unknown" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <Notice
            tone="warn"
            title="Sent, but not confirmed yet"
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ink" icon={<ArrowsClockwise className="size-4" />} onClick={onRecheck}>
                  Check again
                </Button>
                {state.hash && (
                  <a href={explorerTx(state.hash)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 px-2 text-sm text-muted hover:text-ink">
                    Open in explorer <ArrowSquareOut className="size-3.5" />
                  </a>
                )}
              </div>
            }
          >
            Your transaction may still go through. Don&apos;t send it again until you have checked.
          </Notice>
        </motion.div>
      )}
      {state.phase === 'failed' && state.error && state.error.kind !== 'cancelled' && (
        <motion.div key="failed" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <Notice
            tone={state.error.kind === 'unknown' && state.error.title.startsWith('Step') ? 'info' : 'danger'}
            title={state.error.title}
            action={onDismiss && <Button size="sm" variant="soft" onClick={onDismiss}>Dismiss</Button>}
          >
            {state.error.detail}
          </Notice>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
