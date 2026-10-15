import { z } from 'zod';

/**
 * A signed-in Circle wallet for this tab. Kept in sessionStorage: closing the tab signs out, and nothing
 * here can move funds without the user approving a challenge in Circle's UI.
 */
const schema = z.object({
  userToken: z.string(),
  encryptionKey: z.string(),
  walletId: z.string(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  email: z.string().optional(),
  name: z.string().optional(),
});
export type CircleSession = z.infer<typeof schema>;

const KEY = 'plug360:circle-session';
const listeners = new Set<() => void>();

export function loadSession(): CircleSession | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? schema.safeParse(JSON.parse(raw)) : undefined;
    return parsed?.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(s: CircleSession | undefined): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the session lasts until reload.
  }
  listeners.forEach((l) => l());
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** What the header calls a signed-in person: first name from Google, else the part of the email before @. */
export function displayName(s: Pick<CircleSession, 'name' | 'email'> | undefined): string | undefined {
  const first = s?.name?.trim().split(/\s+/)[0];
  if (first) return first;
  const local = s?.email?.split('@')[0]?.trim();
  return local || undefined;
}
