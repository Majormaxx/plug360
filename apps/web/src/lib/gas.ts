import type { Address, Hex } from 'viem';

export type GasDeps = {
  getCode: (a: Address) => Promise<Hex | undefined>;
  estimateGas: () => Promise<bigint>;
  getBalance: (a: Address) => Promise<bigint>;
  requestGas: () => Promise<unknown>;
};

export type GasOutcome = 'smart-wallet' | 'has-gas' | 'sponsored' | 'no-sponsor';

/**
 * Decides whether a wallet needs the gas sponsor before a call. Smart wallets are skipped (Circle's Gas
 * Station covers them); plain keys that can already pay are skipped; otherwise the sponsor tops them up.
 * A server without a sponsor is not an error: the wallet's own "not enough for gas" message then applies.
 */
export async function ensureGasFor(account: Address, maxFeePerGas: bigint, deps: GasDeps, isUnconfigured: (err: unknown) => boolean): Promise<GasOutcome> {
  const code = await deps.getCode(account);
  if (code && code !== '0x') return 'smart-wallet';
  const [gas, balance] = await Promise.all([deps.estimateGas(), deps.getBalance(account)]);
  if (balance >= gas * maxFeePerGas) return 'has-gas';
  try {
    await deps.requestGas();
    return 'sponsored';
  } catch (err) {
    if (isUnconfigured(err)) return 'no-sponsor';
    throw err;
  }
}
