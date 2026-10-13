'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { PublicClient } from 'viem';
import { useConnect, usePublicClient } from 'wagmi';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle/connector';
import { circleEnabled } from '@/lib/circle/config';
import { loginErrorMessage, loginStatus, resumeGoogleLogin } from '@/lib/circle/login';

/** Finishes a Google sign-in when Google sends the person back, then returns them to where they started. */
export function CircleResume() {
  const publicClient = usePublicClient() as PublicClient | undefined;
  const { connectors, connectAsync } = useConnect();
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (!circleEnabled || !publicClient || ran.current) return;
    ran.current = true;
    resumeGoogleLogin(publicClient)
      .then(async (r) => {
        if (!r) return;
        const c = connectors.find((x) => x.id === CIRCLE_CONNECTOR_ID);
        if (c) await connectAsync({ connector: c });
        toast.success('Signed in', { description: r.session.email ?? 'Your Arc wallet is ready.' });
        if (r.returnTo && r.returnTo !== window.location.pathname + window.location.hash) router.replace(r.returnTo);
      })
      .catch((err) => {
        loginStatus.set({ step: 'error', message: loginErrorMessage(err) });
        toast.error(loginErrorMessage(err));
      });
  }, [publicClient, connectors, connectAsync, router]);

  return null;
}
