import { createPublicClient, createWalletClient, fallback, http, nonceManager, parseUnits, type Address, type Chain, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSponsor } from './sponsor.js';

export * from './contract.js';
export { gasEligibility, topUpAmount, type Eligibility } from './policy.js';
export { createSponsor, SponsorError, termsFromWire, type SponsorDeps } from './sponsor.js';

/** Builds the sponsor from server config. The key belongs to a hot wallet that only ever holds gas money. */
export function sponsorFromKey(opts: { privateKey: `0x${string}`; chain: Chain; rpcUrls: string[]; escrow: Address; maxTopUp?: string }) {
  const transport = fallback(opts.rpcUrls.map((u) => http(u, { retryCount: 2, timeout: 20_000 })));
  const account = privateKeyToAccount(opts.privateKey, { nonceManager });
  return createSponsor({
    publicClient: createPublicClient({ chain: opts.chain, transport }) as PublicClient,
    walletClient: createWalletClient({ chain: opts.chain, transport, account }),
    account,
    chain: opts.chain,
    escrow: opts.escrow,
    maxTopUp: parseUnits(opts.maxTopUp ?? '0.05', 18),
  });
}
