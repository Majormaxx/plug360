'use client';

import { EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { PublicClient } from 'viem';
import { useConnect, usePublicClient } from 'wagmi';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle/connector';
import { circleConfig } from '@/lib/circle/config';
import { loginErrorMessage, loginStatus, startEmailLogin, startGoogleLogin, type LoginStep } from '@/lib/circle/login';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { Notice } from '../ui/Notice';

const STEP_TEXT: Partial<Record<LoginStep, string>> = {
  redirecting: 'Opening Google',
  code: 'Check your email for a code',
  'signing-in': 'Signing you in',
  creating: 'Setting up your Arc wallet',
  activating: 'Activating your wallet (one approval)',
};

/** Google and email sign-in through Circle. Each person gets their own Arc wallet; Plug360 never holds it. */
export function CircleSignIn({ onDone }: { onDone: () => void }) {
  const status = useSyncExternalStore(loginStatus.subscribe, loginStatus.get, loginStatus.get);
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { connectors, connectAsync } = useConnect();
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const busy = !!STEP_TEXT[status.step];

  const fail = (err: unknown) => {
    const message = loginErrorMessage(err);
    loginStatus.set({ step: 'error', message });
    toast.error(message);
  };

  async function connectCircle() {
    const c = connectors.find((x) => x.id === CIRCLE_CONNECTOR_ID);
    if (c) await connectAsync({ connector: c });
    onDone();
  }

  return (
    <div className="space-y-3">
      <Button size="lg" variant="ink" className="w-full" disabled={busy} icon={<GoogleLogo weight="bold" className="size-5" />} onClick={() => startGoogleLogin().catch(fail)}>
        Continue with Google
      </Button>
      {circleConfig.emailEnabled &&
        (showEmail ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!publicClient) return;
              startEmailLogin(email.trim(), publicClient)
                .then(connectCircle)
                .catch(fail);
            }}
          >
            <Input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
            <Button type="submit" className="h-12 shrink-0" disabled={busy || !email.includes('@')}>
              Send code
            </Button>
          </form>
        ) : (
          <Button size="lg" variant="soft" className="w-full" disabled={busy} icon={<EnvelopeSimple className="size-5" />} onClick={() => setShowEmail(true)}>
            Continue with email
          </Button>
        ))}
      {busy && (
        <p role="status" className="text-center text-sm text-muted">
          {STEP_TEXT[status.step]}…
        </p>
      )}
      {status.step === 'error' && status.message && <Notice tone="danger" title={status.message} />}
      <p className="text-xs leading-relaxed text-muted">
        Signing in creates an Arc wallet that only you can approve payments from, secured by Circle. Payments take two quick approvals instead of one.
      </p>
    </div>
  );
}
