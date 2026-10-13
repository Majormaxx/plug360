import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { network } from './config';

const transport = (urls: string[]) =>
  fallback(
    urls.map((url) => http(url, { retryCount: 2, retryDelay: 400, timeout: 15_000 })),
    { rank: false },
  );

/**
 * Wallets injected into the page (browser extensions and the in-app browsers of mobile wallets). EIP-6963
 * discovery lists each installed wallet by name. Calls stay with the EOA the person controls, which is
 * what Arc's one-transaction pay path needs.
 */
export const wagmiConfig = createConfig({
  chains: [network.chain],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: { [network.chain.id]: transport(network.rpcUrls) },
  ssr: true,
});

/** One client per log-capable RPC, in order, for the deals scan. */
export const logClients: PublicClient[] = network.logRpcUrls.map(
  (url) => createPublicClient({ chain: network.chain, transport: http(url, { retryCount: 0, timeout: 20_000 }) }) as PublicClient,
);

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
