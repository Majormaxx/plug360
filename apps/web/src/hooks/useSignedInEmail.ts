'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { loadSession, onSessionChange } from '@/lib/circle/session';

/** The Google or email address behind a Circle sign-in for `account`, or undefined for wallet-app users. */
export function useSignedInEmail(account: Address | undefined): string | undefined {
  const [email, setEmail] = useState<string>();
  useEffect(() => {
    const read = () => {
      const s = loadSession();
      setEmail(s && account && s.address.toLowerCase() === account.toLowerCase() ? s.email : undefined);
    };
    read();
    return onSessionChange(read);
  }, [account]);
  return email;
}
