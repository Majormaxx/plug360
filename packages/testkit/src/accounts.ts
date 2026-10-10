import { mnemonicToAccount, type HDAccount } from 'viem/accounts';
import { toHex } from 'viem';

/** Anvil's default development mnemonic. These keys are public; never use them on a real network. */
export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

export function anvilAccount(index: number): HDAccount {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });
}

export function anvilPrivateKey(index: number) {
  const key = anvilAccount(index).getHdKey().privateKey;
  if (!key) throw new Error('no private key');
  return toHex(key);
}

/** Fixed roles over the anvil accounts so tests read clearly. */
export const roles = {
  owner: 0,
  seller: 1,
  plug: 2,
  buyer: 3,
  keeper: 4,
  stranger: 5,
  seller2: 6,
  buyer2: 7,
} as const;
