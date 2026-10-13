import type { Hex } from 'viem';

export type SignerReadiness = 'ready' | 'needs-activation';

/**
 * Whether the escrow will accept this signature on-chain. A plain key signs 65 bytes and needs no code.
 * A smart wallet signs through ERC-1271, which only works once the wallet contract is deployed; before
 * that, wallets wrap signatures in ERC-6492, which off-chain checks accept but the escrow does not.
 */
export function signerReadiness(code: Hex | undefined, signature: Hex): SignerReadiness {
  const hasCode = !!code && code !== '0x';
  const plainEcdsa = signature.length === 2 + 65 * 2;
  return hasCode || plainEcdsa ? 'ready' : 'needs-activation';
}
