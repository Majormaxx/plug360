'use client';

import { useEffect, useState } from 'react';

/** Unix seconds, ticking every `everyMs` while the tab is visible. Returns 0 until mounted to keep SSR stable. */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    let id = setInterval(tick, everyMs);
    const onVis = () => {
      clearInterval(id);
      if (document.visibilityState === 'visible') {
        tick();
        id = setInterval(tick, everyMs);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [everyMs]);
  return now;
}
