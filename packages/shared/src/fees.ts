import { parseGwei, type PublicClient } from 'viem';
import { MIN_FEE_GWEI, PRIORITY_FEE_GWEI } from './chains.js';

export const MIN_MAX_FEE_PER_GAS = parseGwei(String(MIN_FEE_GWEI));
export const MAX_PRIORITY_FEE_PER_GAS = parseGwei(String(PRIORITY_FEE_GWEI));

export type FeeOverrides = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/** Arc fee rule from a base fee: maxFeePerGas = max(2 x baseFee, 25 gwei), priority 1 gwei. */
export function feeOverridesFromBaseFee(baseFeePerGas: bigint): FeeOverrides {
  const doubled = baseFeePerGas * 2n;
  return {
    maxFeePerGas: doubled > MIN_MAX_FEE_PER_GAS ? doubled : MIN_MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
  };
}

/** Reads the latest base fee and applies the Arc fee rule. Pass the result into any write call. */
export async function feeOverrides(publicClient: Pick<PublicClient, 'getBlock'>): Promise<FeeOverrides> {
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  return feeOverridesFromBaseFee(block.baseFeePerGas ?? 0n);
}
