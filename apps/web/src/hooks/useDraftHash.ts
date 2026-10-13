'use client';

import { useCallback, useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/**
 * The URL fragment as state. Fragments never reach a server, which is why drafts live there. Writing uses
 * replaceState so signing does not add a history entry per signature.
 */
export function useHashState(): [string, (next: string) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => '');
  const set = useCallback((next: string) => {
    const url = `${window.location.pathname}${window.location.search}#${next}`;
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);
  return [hash, set];
}
