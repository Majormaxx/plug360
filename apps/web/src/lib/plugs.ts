import { getAddress, type Address } from 'viem';
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from '@plug360/shared';
import { network } from './config';

export type PlugEntry = { address: Address; name: string; note: string };

/**
 * Plugs listed by the contract owner, with the name they asked to show. Listing is done by hand while the
 * contract is new, so this list is updated at the same time. The level shown in the app is always read
 * from the contract; an entry whose level is 0 on-chain is hidden.
 */
const DIRECTORY: Record<number, PlugEntry[]> = {
  [ARC_TESTNET_ID]: [
    { address: getAddress('0xc98AA1601B5c088EFc73Ae71706A10343a5c642c'), name: 'Plug360 test plug', note: 'For trying the app on testnet' },
  ],
  [ARC_MAINNET_ID]: [],
};

export const listedPlugs: PlugEntry[] = DIRECTORY[network.chain.id] ?? [];
