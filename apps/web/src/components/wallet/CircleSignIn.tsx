'use client';

import { ArrowClockwise, EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { PublicClient } from 'viem';
import { useConnect, usePublicClient } from 'wagmi';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle/connector';
import { circleConfig } from '@/lib/circle/config';
import { BLOCKED_FRAME_MESSAGE } from '@/lib/circle/errors';
import { deviceCheck } from '@/lib/circle/sdk';
import { loginErrorMessage, loginStatus, startEmailLogin, startGoogleLogin, type LoginStep } from '@/lib/circle/login';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { Notice } from '../ui/Notice';

export const STEP_TEXT: Partial<Record<LoginStep, string>> = {
  redirecting: 'Opening Google',
  code: 'Sending your code. Enter it in the window that opens',
  'signing-in': 'Signing you in',
  creating: 'Setting up your Arc wallet',
  activating: 'Activating your wallet (one approval)',
};

/**
 * Email first, Google second. Each person gets their own Arc wallet; Plug360 never holds it.
 * Circle's code and PIN windows are iframes, and a modal <dialog> always paints above them, so the
 * sheet closes as soon as sign-in starts and CircleLoginProgress reports progress from then on.
 */
export function CircleSignIn({ onDone, onBlocked }: { onDone: () => void; onBlocked?: () => void }) {
  const status = useSyncExternalStore(loginStatus.subscribe, loginStatus.get, loginStatus.get);
  const device = useSyncExternalStore(deviceCheck.subscribe, deviceCheck.get, () => 'idle' as const);
  const blocked = device === 'blocked';
  // A blocked browser can still sign in with a wallet app, so open that path for them.
  useEffect(() => {
    if (blocked) onBlocked?.();
  }, [blocked, onBlocked]);
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { connectors, connectAsync } = useConnect();
  const [email, setEmail] = useState('');
  const busy = !!STEP_TEXT[status.step];

  const fail = (err: unknown) => {
    const message = loginErrorMessage(err);
    loginStatus.set({ step: 'error', message });
    // The blocked-browser case gets its own inline guidance below; a toast would only repeat it.
    if (message !== BLOCKED_FRAME_MESSAGE) toast.error(message);
  };

  async function connectCircle() {
    const c = connectors.find((x) => x.id === CIRCLE_CONNECTOR_ID);
    if (c) await connectAsync({ connector: c });
    toast.success('Signed in', { description: email.trim() });
  }

  return (
    <div className="space-y-3">
      {circleConfig.emailEnabled && (
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!publicClient) return;
            onDone();
            startEmailLogin(email.trim(), publicClient)
              .then(connectCircle)
              .catch(fail);
          }}
        >
          <Input type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
          <Button type="submit" size="lg" variant="ink" className="w-full" disabled={busy || !email.includes('@')} icon={<EnvelopeSimple weight="bold" className="size-5" />}>
            Email me a sign-in code
          </Button>
        </form>
      )}
      {circleConfig.googleEnabled && blocked && (
        <Notice
          tone="warn"
          title="Google sign-in is blocked in this browser"
          action={
            <Button size="sm" variant="ink" icon={<ArrowClockwise weight="bold" className="size-4" />} onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>Click the eye icon in the address bar (Chrome) or open this site&apos;s privacy settings.</li>
            <li>Allow third-party cookies for plug360.xyz.</li>
            <li>Reload and sign in again, or use a crypto wallet below.</li>
          </ol>
        </Notice>
      )}
      {circleConfig.googleEnabled && !blocked && (
        <Button size="lg" variant={circleConfig.emailEnabled ? 'soft' : 'ink'} className="w-full" disabled={busy} icon={<GoogleLogo weight="bold" className="size-5" />} onClick={() => startGoogleLogin().catch(fail)}>
          Continue with Google
        </Button>
      )}
      {busy && (
        <p role="status" className="text-center text-sm text-muted">
          {STEP_TEXT[status.step]}…
        </p>
      )}
      {status.step === 'error' && status.message && status.message !== BLOCKED_FRAME_MESSAGE && <Notice tone="danger" title={status.message} />}
      <p className="text-xs leading-relaxed text-muted">
        No app or crypto needed. Signing in creates an Arc wallet that only you can approve payments from, secured by Circle.
      </p>
    </div>
  );
}

/** Mirrors sign-in progress into a toast, since the sign-in sheet is closed while Circle's windows are up. */
export function CircleLoginProgress() {
  const status = useSyncExternalStore(loginStatus.subscribe, loginStatus.get, loginStatus.get);
  useEffect(() => {
    const text = STEP_TEXT[status.step];
    if (text && status.step !== 'redirecting') toast.loading(`${text}…`, { id: 'circle-login' });
    else toast.dismiss('circle-login');
  }, [status.step]);
  return null;
}
