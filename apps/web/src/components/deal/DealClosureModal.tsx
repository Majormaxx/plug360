'use client';

/**
 * Full-screen modal that fires once when a deal reaches settled or refunded.
 * Step 1: animated outcome card (confetti on settled).
 * Step 2: review form (star picker + 280-char text, wallet-signed).
 * Step 3: thank-you card with link to plug profile.
 *
 * Fires once per deal ID per device via localStorage. Respects prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useAccount, useSignMessage } from 'wagmi';
import { getAddress, type Address } from 'viem';
import { reviewPayload } from '@plug360/shared';
import { Button, ButtonLink } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { usdc } from '@/lib/format';

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = {
  dealIdHex: string;
  title: string;
  price: bigint;
  phase: 'settled' | 'refunded';
  wasDisputed: boolean;
  plugAddress: Address;
  plugName?: string;
};

type Step = 'outcome' | 'review' | 'thanks';

// ─── localStorage helpers ────────────────────────────────────────────────────

const STORAGE_KEY = 'plug360:closure-seen';

function hasSeen(dealIdHex: string): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    return seen.includes(dealIdHex.toLowerCase());
  } catch {
    return false;
  }
}

function markSeen(dealIdHex: string): void {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!seen.includes(dealIdHex.toLowerCase())) seen.push(dealIdHex.toLowerCase());
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(seen.slice(-100)));
  } catch {}
}

// ─── Confetti ────────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 60;

const COLORS = ['#f2663b', '#3bb273', '#e0a82e', '#17141f', '#fffaf2'];

function Confetti() {
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 120,
    y: -(Math.random() * 160 + 40),
    rotate: (Math.random() - 0.5) * 720,
    scale: Math.random() * 0.6 + 0.4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    delay: Math.random() * 0.3,
    width: Math.random() * 8 + 4,
    height: Math.random() * 12 + 6,
  }));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-sm"
          style={{
            left: '50%',
            top: '40%',
            width: p.width,
            height: p.height,
            backgroundColor: p.color,
            originX: '50%',
            originY: '50%',
          }}
          initial={{ x: 0, y: 0, rotate: 0, scale: 0, opacity: 1 }}
          animate={{
            x: `${p.x}vw`,
            y: `${p.y}vh`,
            rotate: p.rotate,
            scale: p.scale,
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: 1.2,
            delay: p.delay,
            ease: [0.2, 0, 0.8, 1],
            opacity: { times: [0, 0.65, 1] },
          }}
        />
      ))}
    </div>
  );
}

// ─── Star picker ─────────────────────────────────────────────────────────────

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-2" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          className="press text-4xl leading-none transition-colors duration-75"
          style={{
            transitionDelay: `${(n - 1) * 50}ms`,
            color: (hovered || value) >= n ? 'var(--gold)' : 'var(--raised)',
          }}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── Slide directions (always left → right on enter, right → left on exit) ───

const SLIDE = {
  enter: { x: 40, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -40, opacity: 0 },
};
const SLIDE_TRANSITION = { duration: 0.25, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] };

// ─── Step 1 — Outcome ────────────────────────────────────────────────────────

function OutcomeStep({
  phase, title, price, wasDisputed, plugName, onReview, onDismiss,
}: {
  phase: 'settled' | 'refunded';
  title: string;
  price: bigint;
  wasDisputed: boolean;
  plugName?: string;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const settled = phase === 'settled';
  return (
    <motion.div
      key="outcome"
      variants={SLIDE}
      initial="enter"
      animate="center"
      exit="exit"
      transition={SLIDE_TRANSITION}
      className="space-y-6 text-center"
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.05 }}
        className={cn(
          'mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl',
          settled ? 'bg-mint-soft text-mint' : 'bg-accent-soft text-accent',
        )}
      >
        {settled ? '✓' : '↩'}
      </motion.div>

      {/* Copy */}
      <div className="space-y-2">
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="font-display text-2xl font-semibold tracking-tight"
        >
          {settled ? 'Deal done' : 'Refunded'}
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="text-muted"
        >
          {settled
            ? `"${title}" — $${usdc(price)} paid out`
            : `$${usdc(price)} returned to your wallet`}
        </motion.p>
        {wasDisputed && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-sm text-muted"
          >
            {settled
              ? `Your plug ${plugName ? `(${plugName}) ` : ''}ruled for the seller.`
              : `Your plug ${plugName ? `(${plugName}) ` : ''}ruled in your favour.`}
          </motion.p>
        )}
      </div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.3 }}
        className="space-y-2"
      >
        <Button size="lg" className="w-full" onClick={onReview}>
          Leave a review for {plugName ?? 'your plug'}
        </Button>
        <Button variant="ghost" size="md" className="w-full" onClick={onDismiss}>
          Maybe later
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ─── Step 2 — Review form ────────────────────────────────────────────────────

function ReviewStep({
  dealId, plugAddress, wasDisputed, onDone, onBack,
}: {
  dealId: string;
  plugAddress: Address;
  wasDisputed: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'signing' | 'submitting' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  async function submit() {
    if (rating === 0 || !text.trim() || !address) return;
    setStatus('signing');
    setErrMsg('');
    try {
      const payload = reviewPayload({
        dealId,
        plugAddress: getAddress(plugAddress),
        buyerAddress: getAddress(address),
        rating: rating as 1 | 2 | 3 | 4 | 5,
        text: text.trim(),
        wasDisputed,
      });
      const signature = await signMessageAsync({ message: payload });
      setStatus('submitting');
      const res = await fetch('/api/reputation/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId,
          plugAddress: getAddress(plugAddress),
          buyerAddress: getAddress(address),
          rating,
          text: text.trim(),
          wasDisputed,
          signature,
        }),
      });
      if (!res.ok && res.status !== 409) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? 'could not save review');
      }
      onDone();
    } catch (err: unknown) {
      setStatus('error');
      setErrMsg(err instanceof Error ? err.message : 'something went wrong');
    }
  }

  return (
    <motion.div
      key="review"
      variants={SLIDE}
      initial="enter"
      animate="center"
      exit="exit"
      transition={SLIDE_TRANSITION}
      className="space-y-5"
    >
      <div className="space-y-1">
        <p className="font-display text-xl font-semibold tracking-tight">How did your plug do?</p>
        <p className="text-sm text-muted">Your review is public and helps the next buyer decide.</p>
      </div>

      <StarPicker value={rating} onChange={setRating} />

      <div className="space-y-1">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 280))}
          placeholder="Describe how the plug handled this deal…"
          rows={4}
          className="w-full resize-none rounded-[14px] border border-line bg-bg px-3.5 py-3 text-[15px] text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <p className="text-right text-xs text-faint">{text.length}/280</p>
      </div>

      {status === 'error' && (
        <p className="rounded-[10px] bg-danger-soft px-3 py-2 text-sm text-danger-ink">{errMsg}</p>
      )}

      <div className="space-y-2">
        <Button
          size="lg"
          className="w-full"
          disabled={rating === 0 || !text.trim()}
          loading={status === 'signing' || status === 'submitting'}
          onClick={submit}
        >
          {status === 'signing' ? 'Check your wallet…' : status === 'submitting' ? 'Saving…' : 'Submit review'}
        </Button>
        <Button variant="ghost" size="md" className="w-full" onClick={onBack}>
          Back
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Step 3 — Thanks ─────────────────────────────────────────────────────────

function ThanksStep({ plugAddress, plugName, onDismiss }: { plugAddress: Address; plugName?: string; onDismiss: () => void }) {
  return (
    <motion.div
      key="thanks"
      variants={SLIDE}
      initial="enter"
      animate="center"
      exit="exit"
      transition={SLIDE_TRANSITION}
      className="space-y-6 text-center"
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-mint-soft text-4xl text-mint"
      >
        ★
      </motion.div>
      <div className="space-y-2">
        <p className="font-display text-2xl font-semibold tracking-tight">Thanks for the review</p>
        <p className="text-sm text-muted">
          {plugName ? `${plugName}'s` : "This plug's"} next buyer will see it.
        </p>
      </div>
      <div className="space-y-2">
        <ButtonLink
          href={`/plugs/${plugAddress}`}
          target="_blank"
          rel="noreferrer"
          variant="soft"
          size="lg"
          className="w-full"
        >
          View {plugName ?? 'plug'} profile
        </ButtonLink>
        <Button variant="ghost" size="md" className="w-full" onClick={onDismiss}>
          Close
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

export function DealClosureModal({
  dealIdHex, title, price, phase, wasDisputed, plugAddress, plugName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('outcome');
  const [showConfetti, setShowConfetti] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { address } = useAccount();

  // Only show for the buyer (address is not null) and only once per deal.
  useEffect(() => {
    if (!address) return;
    if (hasSeen(dealIdHex)) return;
    // Small delay so the receipt page finishes rendering first.
    const t = setTimeout(() => {
      markSeen(dealIdHex);
      setOpen(true);
      if (phase === 'settled') setShowConfetti(true);
    }, 800);
    return () => clearTimeout(t);
  }, [dealIdHex, address, phase]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function dismiss() {
    setOpen(false);
    setShowConfetti(false);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={dismiss}
      onClick={(e) => e.target === e.currentTarget && dismiss()}
      className="closure-modal border-0 bg-transparent p-0 text-ink"
      aria-label="Deal closed"
    >
      <div className="relative mx-auto w-full max-w-sm rounded-[24px] bg-surface p-6 shadow-card">
        {showConfetti && <Confetti />}
        <AnimatePresence mode="wait" initial={false}>
          {step === 'outcome' && (
            <OutcomeStep
              key="outcome"
              phase={phase}
              title={title}
              price={price}
              wasDisputed={wasDisputed}
              plugName={plugName}
              onReview={() => setStep('review')}
              onDismiss={dismiss}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              key="review"
              dealId={dealIdHex}
              plugAddress={plugAddress}
              wasDisputed={wasDisputed}
              onDone={() => setStep('thanks')}
              onBack={() => setStep('outcome')}
            />
          )}
          {step === 'thanks' && (
            <ThanksStep
              key="thanks"
              plugAddress={plugAddress}
              plugName={plugName}
              onDismiss={dismiss}
            />
          )}
        </AnimatePresence>
      </div>
    </dialog>
  );
}
