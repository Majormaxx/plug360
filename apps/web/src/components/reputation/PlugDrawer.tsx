'use client';

/**
 * Side-sheet (desktop) / bottom-sheet (mobile) that shows the full plug
 * reputation card without leaving the deal room.
 *
 * Pre-fetch: the parent passes the plug address on mount; data loading starts
 * immediately so the sheet fills instantly when the user taps "See full profile".
 *
 * Mobile: slides up from bottom with drag-to-dismiss.
 * Desktop (≥640px): slides in from the right.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { type Address } from 'viem';
import { X, ArrowSquareOut } from '@phosphor-icons/react';
import { usePlugCard } from '@/hooks/usePlugCard';
import { PlugCardFull } from './PlugCardFull';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { usdc } from '@/lib/format';

// ─── Trigger button ───────────────────────────────────────────────────────────

export function PlugDrawerTrigger({ address, className }: { address: Address; className?: string }) {
  const [open, setOpen] = useState(false);
  // Pre-fetch eagerly so the drawer fills instantly.
  const { card } = usePlugCard(address);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'press inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline',
          className,
        )}
      >
        See full profile →
      </button>

      <PlugDrawer
        address={address}
        open={open}
        onClose={() => setOpen(false)}
        prefetchedCard={card}
      />
    </>
  );
}

// ─── Drawer shell ─────────────────────────────────────────────────────────────

type DrawerProps = {
  address: Address;
  open: boolean;
  onClose: () => void;
  prefetchedCard?: ReturnType<typeof usePlugCard>['card'];
};

function PlugDrawer({ address, open, onClose, prefetchedCard }: DrawerProps) {
  const dragControls = useDragControls();
  const dragY = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Lock body scroll while open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const level = prefetchedCard?.level ?? 0;
  const cap = prefetchedCard?.levelCap ?? 0n;
  const staked = prefetchedCard?.staked ?? 0n;
  const plugName = prefetchedCard?.profile?.name;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            ref={overlayRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />

          {/* Mobile: bottom sheet */}
          <motion.div
            key="mobile-sheet"
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[24px] bg-surface shadow-card sm:hidden"
            style={{ maxHeight: '92dvh' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.3 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 300) onClose();
            }}
          >
            {/* Drag handle */}
            <div
              className="flex shrink-0 cursor-grab justify-center py-3 active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="h-1 w-10 rounded-full bg-line-strong" />
            </div>

            <DrawerHeader
              plugName={plugName}
              level={level}
              cap={cap}
              staked={staked}
              address={address}
              onClose={onClose}
            />

            <div className="overflow-y-auto overscroll-contain px-4 pb-6 pt-2">
              <PlugDrawerContent address={address} />
            </div>
          </motion.div>

          {/* Desktop: right side panel */}
          <motion.div
            key="desktop-panel"
            className="fixed inset-y-0 right-0 z-50 hidden w-[420px] flex-col bg-surface shadow-[−2px_0_24px_rgb(0_0_0/0.12)] sm:flex"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <DrawerHeader
              plugName={plugName}
              level={level}
              cap={cap}
              staked={staked}
              address={address}
              onClose={onClose}
            />

            <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2">
              <PlugDrawerContent address={address} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Sticky header inside the drawer ─────────────────────────────────────────

function DrawerHeader({
  plugName, level, cap, staked, address, onClose,
}: {
  plugName?: string; level: number; cap: bigint; staked: bigint; address: Address; onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-semibold">
          {plugName ?? 'Plug profile'}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {level > 0 && (
            <Badge tone="gold" className="text-[11px]">Level {level} · ${usdc(cap)} max</Badge>
          )}
          {staked > 0n && (
            <Badge tone="mint" className="text-[11px]">${usdc(staked)} staked</Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <a
          href={`/plugs/${address}`}
          target="_blank"
          rel="noreferrer"
          className="press rounded-full p-2 text-muted hover:bg-raised hover:text-ink"
          title="Open full page"
        >
          <ArrowSquareOut className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="press rounded-full p-2 text-muted hover:bg-raised hover:text-ink"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Inner content ────────────────────────────────────────────────────────────

function PlugDrawerContent({ address }: { address: Address }) {
  return (
    <div className="space-y-4">
      {/* PlugCardFull without its outer Panel wrapper to avoid double borders */}
      <PlugCardFull address={address} bare />

      {/* Quick actions */}
      <Button
        variant="soft"
        size="sm"
        className="w-full"
        onClick={() => {
          const url = new URL('/new', window.location.origin);
          url.searchParams.set('plug', address);
          window.open(url.toString(), '_blank');
        }}
      >
        Start a new deal with this plug
      </Button>
    </div>
  );
}
