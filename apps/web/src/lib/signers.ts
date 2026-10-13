import { isErc6492Signature, type Hex } from 'viem';

/**
 * - `ready`: the escrow can verify this signature as it is (a plain key, or a deployed smart wallet).
 * - `deploy`: a smart wallet that has not made its first transaction signed with an ERC-6492 wrapper; the
 *   gas sponsor deploys it during payment, so nobody has to do anything.
 * - `unusable`: an undeployed wallet signed without a wrapper, so nothing can make the escrow accept it.
 */
export type SignerReadiness = 'ready' | 'deploy' | 'unusable';

export function signerReadiness(code: Hex | undefined, signature: Hex): SignerReadiness {
  const hasCode = !!code && code !== '0x';
  if (hasCode) return 'ready';
  if (isErc6492Signature(signature)) return 'deploy';
  return signature.length === 2 + 65 * 2 ? 'ready' : 'unusable';
}
