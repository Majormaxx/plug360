import type { Hash } from 'viem';
import type { FriendlyError } from './errors';

/**
 * Life of one user action that may need several transactions (approve, then pay):
 * idle -> checking -> wallet -> pending -> (next step: checking ...) -> done
 * with failed (cancelled, reverted, network) and unknown (sent, but no receipt yet) as exits.
 */
export type TxPhase = 'idle' | 'checking' | 'wallet' | 'pending' | 'done' | 'failed' | 'unknown';

export type TxState = {
  phase: TxPhase;
  label: string;
  step: number;
  steps: number;
  hash?: Hash;
  hashes: Hash[];
  error?: FriendlyError;
};

export type TxEvent =
  | { type: 'start'; label: string; steps?: number }
  | { type: 'prompt' }
  | { type: 'sent'; hash: Hash }
  | { type: 'confirmed' }
  | { type: 'fail'; error: FriendlyError }
  | { type: 'lost'; error: FriendlyError }
  | { type: 'reset' };

export const idleTx: TxState = { phase: 'idle', label: '', step: 0, steps: 1, hashes: [] };

const BUSY: TxPhase[] = ['checking', 'wallet', 'pending'];
export const isBusy = (s: TxState) => BUSY.includes(s.phase);

export function txReducer(state: TxState, event: TxEvent): TxState {
  switch (event.type) {
    case 'start':
      // One action at a time: a second click while busy is ignored.
      if (isBusy(state)) return state;
      return { phase: 'checking', label: event.label, step: 1, steps: Math.max(1, event.steps ?? 1), hashes: [] };
    case 'prompt':
      return state.phase === 'checking' ? { ...state, phase: 'wallet' } : state;
    case 'sent':
      return state.phase === 'wallet'
        ? { ...state, phase: 'pending', hash: event.hash, hashes: [...state.hashes, event.hash] }
        : state;
    case 'confirmed': {
      // From unknown too: a later check can prove the transaction landed.
      if (state.phase !== 'pending' && state.phase !== 'unknown') return state;
      if (state.step < state.steps) {
        const { hash: _h, error: _e, ...rest } = state;
        return { ...rest, phase: 'checking', step: state.step + 1 };
      }
      const { error: _e, ...rest } = state;
      return { ...rest, phase: 'done' };
    }
    case 'fail':
      return isBusy(state) ? { ...state, phase: 'failed', error: event.error } : state;
    case 'lost':
      return state.phase === 'pending' ? { ...state, phase: 'unknown', error: event.error } : state;
    case 'reset':
      return isBusy(state) ? state : idleTx;
  }
}
