import { describe, expect, it } from 'vitest';
import { signerReadiness } from '../src/lib/signers';

const ecdsa = `0x${'11'.repeat(65)}` as const;
const wrapped = `0x${'22'.repeat(200)}6492649264926492649264926492649264926492649264926492649264926492` as const;

describe('signerReadiness', () => {
  it('accepts a plain key signature with no code', () => {
    expect(signerReadiness('0x', ecdsa)).toBe('ready');
    expect(signerReadiness(undefined, ecdsa)).toBe('ready');
  });

  it('accepts any signature from a deployed smart wallet', () => {
    expect(signerReadiness('0x6080', wrapped)).toBe('ready');
  });

  it('flags a smart-wallet signature whose wallet is not deployed yet', () => {
    expect(signerReadiness('0x', wrapped)).toBe('needs-activation');
    expect(signerReadiness(undefined, `0x${'33'.repeat(64)}`)).toBe('needs-activation');
  });
});
