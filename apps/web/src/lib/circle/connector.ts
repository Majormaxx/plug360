import { createConnector } from 'wagmi';
import { getAddress, type EIP1193Provider } from 'viem';
import { network } from '../config';
import { walletsApi } from './api';
import { createCircleProvider, type CircleProvider } from './provider';
import { runChallenge } from './sdk';
import { loadSession, onSessionChange, saveSession } from './session';

export const CIRCLE_CONNECTOR_ID = 'circle';

/**
 * wagmi connector for a Circle wallet created through Google or email sign-in. Signing in happens first
 * (see useCircleLogin); connecting then just reads the stored session.
 */
export function circleConnector() {
  let provider: CircleProvider | undefined;
  let unsubscribe: (() => void) | undefined;

  return createConnector<EIP1193Provider>((config) => {
    const rpc = async (method: string, params: unknown) => {
      const transport = config.transports?.[network.chain.id];
      if (!transport) throw new Error('No Arc transport configured');
      const t = transport({ chain: network.chain, retryCount: 2 });
      return t.request({ method, params } as never);
    };
    const get = () =>
      (provider ??= createCircleProvider({
        chainId: network.chain.id,
        api: walletsApi,
        getSession: loadSession,
        runChallenge,
        rpc,
        onExpired: () => saveSession(undefined),
      }));

    return {
      id: CIRCLE_CONNECTOR_ID,
      name: 'Google or email',
      type: 'circle',
      async setup() {
        unsubscribe ??= onSessionChange(() => {
          const s = loadSession();
          if (s) config.emitter.emit('change', { accounts: [getAddress(s.address)] });
          else config.emitter.emit('disconnect');
        });
      },
      async connect(params) {
        const s = loadSession();
        if (!s) throw new Error('Sign in with Google or email first');
        const accounts = [getAddress(s.address)];
        const result = { accounts, chainId: network.chain.id };
        return (params?.withCapabilities ? { ...result, accounts: accounts.map((address) => ({ address, capabilities: {} })) } : result) as never;
      },
      async disconnect() {
        saveSession(undefined);
      },
      async getAccounts() {
        const s = loadSession();
        return s ? [getAddress(s.address)] : [];
      },
      async getChainId() {
        return network.chain.id;
      },
      async getProvider() {
        return get() as unknown as EIP1193Provider;
      },
      async isAuthorized() {
        return !!loadSession();
      },
      async switchChain({ chainId }) {
        if (chainId !== network.chain.id) throw new Error('This wallet only works on Arc');
        return network.chain;
      },
      onAccountsChanged(accounts) {
        if (accounts.length === 0) config.emitter.emit('disconnect');
        else config.emitter.emit('change', { accounts: accounts.map((a) => getAddress(a)) });
      },
      onChainChanged(chain) {
        config.emitter.emit('change', { chainId: Number(chain) });
      },
      onDisconnect() {
        config.emitter.emit('disconnect');
      },
    };
  });
}

