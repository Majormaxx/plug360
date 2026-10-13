'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

const KEY = 'plug360:theme';
const Ctx = createContext<{ choice: ThemeChoice; resolved: Resolved; setChoice: (c: ThemeChoice) => void }>({
  choice: 'system',
  resolved: 'light',
  setChoice: () => {},
});

/** Runs before first paint so the page never flashes the wrong theme. Kept tiny and dependency-free. */
export const themeScript = `(()=>{try{var c=localStorage.getItem('${KEY}');var d=c==='dark'||((!c||c==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`;

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<Resolved>('light');

  useEffect(() => setChoiceState(readChoice()), []);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const r: Resolved = choice === 'system' ? (mq.matches ? 'dark' : 'light') : choice;
      document.documentElement.dataset.theme = r;
      setResolved(r);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // The theme still applies for this visit.
    }
  }, []);

  return <Ctx.Provider value={{ choice, resolved, setChoice }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
