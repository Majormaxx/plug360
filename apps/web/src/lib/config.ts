import { ARC_MAINNET_ID, ARC_TESTNET_ID, arcMainnet, arcTestnet } from '@plug360/shared';
import { getAddress, type Address, type Chain } from 'viem';
import { z } from 'zod';
import mainnetDeployment from '../../../../contracts/deployments/5042.json';
import testnetDeployment from '../../../../contracts/deployments/5042002.json';

type Network = {
  chain: Chain;
  escrow: Address;
  deployBlock: bigint;
  rpcUrls: string[];
  /** RPCs that accept eth_getLogs over wide ranges; the deals scan uses these first. */
  logRpcUrls: string[];
  explorer: string;
  faucet?: string;
  testnet: boolean;
};

/** Deployments committed in contracts/deployments. */
const DEPLOYMENTS: Partial<Record<number, { escrow: string; deployBlock: number }>> = {
  [ARC_TESTNET_ID]: testnetDeployment,
  [ARC_MAINNET_ID]: mainnetDeployment,
};

const DEFAULTS: Record<number, Omit<Network, 'escrow' | 'deployBlock'>> = {
  [ARC_TESTNET_ID]: {
    chain: arcTestnet,
    rpcUrls: ['https://rpc.drpc.testnet.arc.io', 'https://rpc.testnet.arc.io', 'https://rpc.blockdaemon.testnet.arc.io'],
    logRpcUrls: ['https://rpc.testnet.arc.io', 'https://rpc.blockdaemon.testnet.arc.io', 'https://rpc.drpc.testnet.arc.io'],
    explorer: 'https://explorer.testnet.arc.io',
    faucet: 'https://faucet.circle.com',
    testnet: true,
  },
  [ARC_MAINNET_ID]: {
    chain: arcMainnet,
    rpcUrls: ['https://rpc.drpc.mainnet.arc.io', 'https://rpc.mainnet.arc.io', 'https://rpc.blockdaemon.mainnet.arc.io'],
    logRpcUrls: ['https://rpc.mainnet.arc.io', 'https://rpc.blockdaemon.mainnet.arc.io', 'https://rpc.drpc.mainnet.arc.io'],
    explorer: 'https://explorer.arc.io',
    testnet: false,
  },
};

const envSchema = z.object({
  chainId: z.coerce.number().refine((id) => id in DEFAULTS, 'NEXT_PUBLIC_CHAIN_ID must be 5042 or 5042002'),
  escrow: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  deployBlock: z.coerce.number().int().nonnegative().optional(),
  rpcUrls: z.array(z.url()).optional(),
});

const blank = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : v.trim());

/** Builds the network config from env values. Throws with a readable message when the config is unusable. */
export function resolveNetwork(env: Record<string, string | undefined>): Network {
  const parsed = envSchema.parse({
    chainId: blank(env.NEXT_PUBLIC_CHAIN_ID) ?? ARC_TESTNET_ID,
    escrow: blank(env.NEXT_PUBLIC_ESCROW),
    deployBlock: blank(env.NEXT_PUBLIC_DEPLOY_BLOCK),
    rpcUrls: blank(env.NEXT_PUBLIC_RPC_URLS)?.split(',').map((u) => u.trim()).filter(Boolean),
  });
  const base = DEFAULTS[parsed.chainId]!;
  const deployment = DEPLOYMENTS[parsed.chainId];
  const escrow = parsed.escrow ?? deployment?.escrow;
  if (!escrow) throw new Error(`No DealEscrow deployment for chain ${parsed.chainId}; set NEXT_PUBLIC_ESCROW`);
  const rpcUrls = parsed.rpcUrls ?? base.rpcUrls;
  return {
    ...base,
    chain: { ...base.chain, rpcUrls: { default: { http: rpcUrls } } },
    rpcUrls,
    logRpcUrls: parsed.rpcUrls ?? base.logRpcUrls,
    escrow: getAddress(escrow),
    deployBlock: BigInt(parsed.deployBlock ?? deployment?.deployBlock ?? 0),
  };
}

// Next inlines NEXT_PUBLIC_* only for literal property reads, so each one is named here.
export const network = resolveNetwork({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_ESCROW: process.env.NEXT_PUBLIC_ESCROW,
  NEXT_PUBLIC_DEPLOY_BLOCK: process.env.NEXT_PUBLIC_DEPLOY_BLOCK,
  NEXT_PUBLIC_RPC_URLS: process.env.NEXT_PUBLIC_RPC_URLS,
});

export const escrowDomain = { chainId: network.chain.id, escrow: network.escrow } as const;

export const explorerTx = (hash: string) => `${network.explorer}/tx/${hash}`;
export const explorerAddress = (address: string) => `${network.explorer}/address/${address}`;
