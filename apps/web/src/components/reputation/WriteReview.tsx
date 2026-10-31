'use client';

/**
 * Form for a buyer to write a review after their deal closes.
 * Signs the payload with their connected wallet (EIP-191 personal_sign)
 * and submits to POST /api/reputation/reviews.
 */
import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { getAddress, type Address } from 'viem';
import { reviewPayload } from '@plug360/shared';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { cn } from '@/components/ui/cn';

type Props = {
  dealId: string;
  plugAddress: Address;
  wasDisputed: boolean;
  onDone?: () => void;
};

export function WriteReview({ dealId, plugAddress, wasDisputed, onDone }: Props) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [rating, setRating] = useState<number>(0);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'signing' | 'submitting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hovered, setHovered] = useState(0);

  if (!address) return <Notice tone="info">Connect your wallet to leave a review.</Notice>;

  async function submit() {
    if (rating === 0 || !text.trim()) return;
    setStatus('signing');
    setErrorMsg('');

    try {
      const payload = reviewPayload({
        dealId,
        plugAddress: getAddress(plugAddress),
        buyerAddress: getAddress(address!),
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
          buyerAddress: getAddress(address!),
          rating,
          text: text.trim(),
          wasDisputed,
          signature,
        }),
      });

      if (res.status === 409) {
        setStatus('done'); // already reviewed — treat as success
        onDone?.();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'could not save review');
      }
      setStatus('done');
      onDone?.();
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'something went wrong');
    }
  }

  if (status === 'done') return <Notice tone="success">Review saved. Thanks for the feedback.</Notice>;

  return (
    <div className="space-y-3">
      {/* Star picker */}
      <div className="flex gap-1" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            className={cn(
              'text-2xl transition-colors',
              (hovered || rating) >= n ? 'text-gold' : 'text-raised',
            )}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
      </div>

      {/* Text area */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 280))}
        placeholder="Describe how the plug handled this deal…"
        rows={3}
        className="w-full resize-none rounded-[14px] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      <p className="text-xs text-faint text-right">{text.length}/280</p>

      {status === 'error' && <Notice tone="danger">{errorMsg}</Notice>}

      <Button
        onClick={submit}
        disabled={rating === 0 || !text.trim()}
        loading={status === 'signing' || status === 'submitting'}
        size="sm"
      >
        {status === 'signing' ? 'Waiting for signature…' : status === 'submitting' ? 'Saving…' : 'Submit review'}
      </Button>
    </div>
  );
}
