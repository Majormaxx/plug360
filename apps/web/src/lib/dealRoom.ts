/** Signature status as the deal room sees it after checking against the chain. */
export type SigState = 'missing' | 'checking' | 'valid' | 'invalid';

export type NextActor = 'claim' | 'seller' | 'plug' | 'buyer' | 'blocked';

/**
 * Who has to act next on an unfunded deal link. Either signature can come first; both cover the same
 * terms. The usual order is seller then plug, and an open seat makes the plug go first.
 */
export function nextActor(openSeat: boolean, seller: SigState, plug: SigState): NextActor {
  if (seller === 'invalid' || plug === 'invalid') return 'blocked';
  if (openSeat) return 'claim';
  if (seller !== 'valid') return 'seller';
  if (plug !== 'valid') return 'plug';
  return 'buyer';
}
