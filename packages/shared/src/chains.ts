import { defineChain, type Address } from 'viem';
import { arc } from 'viem/chains';

/** Arc mainnet as shipped by viem. Guarded so a viem upgrade cannot silently change the chain id. */
export const arcMainnet = arc;
if (arcMainnet.id !== 5042) {
  throw new Error(`viem's arc chain has id ${arcMainnet.id}, expected 5042`);
}

/** Arc testnet. Defined here because viem's built-in arcTestnet points at an outdated RPC. */
export const arcTestnet = defineChain({
  id: 5_042_002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' },
  },
  testnet: true,
});

export const ARC_MAINNET_ID = 5042;
export const ARC_TESTNET_ID = 5_042_002;

/** USDC through its ERC-20 interface. Amounts at this address use 6 decimals. */
export const USDC: Address = '0x3600000000000000000000000000000000000000';
export const USDC_DECIMALS = 6;
/** The native gas balance is the same USDC but reported with 18 decimals. Never mix the two scales. */
export const NATIVE_DECIMALS = 18;

/** Arc's Memo contract, used to tag wallet transactions with an order reference. */
export const MEMO: Address = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505';
/** Arc's Multicall3From contract. */
export const MULTICALL3FROM: Address = '0x522fAf9A91c41c443c66765030741e4AaCe147D0';

/** Arc drops transactions priced under 20 gwei; 25 gwei leaves headroom. */
export const MIN_FEE_GWEI = 25;
export const PRIORITY_FEE_GWEI = 1;

/** Arc RPCs reject eth_getLogs over 10,000 blocks. Ranges stay at or below this many blocks. */
export const MAX_LOG_BLOCKS = 9_999;

/** Returns the Arc chain for a known chain id, or undefined. */
export function arcChainById(chainId: number) {
  if (chainId === ARC_MAINNET_ID) return arcMainnet;
  if (chainId === ARC_TESTNET_ID) return arcTestnet;
  return undefined;
}
