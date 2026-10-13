import { describe, expect, it } from 'vitest';
import { serializeErc6492Signature } from 'viem';
import { signerReadiness } from '../src/lib/signers';

const ecdsa = `0x${'11'.repeat(65)}` as const;
const wrapped = serializeErc6492Signature({ address: '0x1234567890123456789012345678901234567890', data: '0xdeadbeef', signature: ecdsa });

describe('signerReadiness', () => {
  it('accepts a plain key signature with no code', () => {
    expect(signerReadiness('0x', ecdsa)).toBe('ready');
    expect(signerReadiness(undefined, ecdsa)).toBe('ready');
  });

  it('accepts any signature from a deployed smart wallet', () => {
    expect(signerReadiness('0x6080', wrapped)).toBe('ready');
  });

  it('hands an undeployed ERC-6492 signer to the sponsor', () => {
    expect(signerReadiness('0x', wrapped)).toBe('deploy');
  });

  it('flags an undeployed wallet signature that carries no way to deploy it', () => {
    expect(signerReadiness(undefined, `0x${'33'.repeat(100)}`)).toBe('unusable');
  });
});
