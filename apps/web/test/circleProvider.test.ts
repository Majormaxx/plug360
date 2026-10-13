import { describe, expect, it, vi } from 'vitest';
import { WalletsApiError, type WalletsApi } from '../src/lib/circle/api';
import { createCircleProvider, ProviderRpcError, type RunChallenge } from '../src/lib/circle/provider';
import type { CircleSession } from '../src/lib/circle/session';

const session: CircleSession = { userToken: 'ut', encryptionKey: 'ek', walletId: 'w1', address: '0x1111111111111111111111111111111111111111' };
const escrow = '0x3df58eFFC292D5043075d71e6705dF6b7348171D';

function setup(over: { api?: WalletsApi; run?: RunChallenge; s?: CircleSession | undefined } = {}) {
  const txStates = [{ state: 'NOT_FOUND' }, { state: 'INITIATED' }, { state: 'SENT', txHash: '0xhash' }];
  const api = (over.api ??
    (vi.fn(async (op: string) => {
      if (op === 'sign-typed-data') return { challengeId: 'c-sign' };
      if (op === 'contract-call') return { challengeId: 'c-call', refId: 'r1' };
      if (op === 'transaction') return txStates.shift() ?? { state: 'SENT', txHash: '0xhash' };
      throw new Error(op);
    }) as unknown as WalletsApi));
  const run = over.run ?? (vi.fn(async (_a, id: string) => (id === 'c-sign' ? { signature: '0xsig' } : {})) as RunChallenge);
  const rpc = vi.fn(async () => '0xrpc');
  const onExpired = vi.fn();
  const p = createCircleProvider({ chainId: 5042002, api, getSession: () => ('s' in over ? over.s : session), runChallenge: run, rpc, onExpired, sleep: async () => {} });
  return { p, api, run, rpc, onExpired };
}

describe('Circle EIP-1193 provider', () => {
  it('answers accounts and chain locally', async () => {
    const { p, rpc } = setup();
    expect(await p.request({ method: 'eth_accounts' })).toEqual([session.address]);
    expect(await p.request({ method: 'eth_chainId' })).toBe('0x4cef52');
    expect(rpc).not.toHaveBeenCalled();
    expect(await setup({ s: undefined }).p.request({ method: 'eth_requestAccounts' })).toEqual([]);
  });

  it('signs typed data through a Circle challenge', async () => {
    const { p, api, run } = setup();
    const typed = { domain: { name: 'DealEscrow' }, types: {}, primaryType: 'Terms', message: {} };
    expect(await p.request({ method: 'eth_signTypedData_v4', params: [session.address, JSON.stringify(typed)] })).toBe('0xsig');
    expect(api).toHaveBeenCalledWith('sign-typed-data', { walletId: 'w1', data: JSON.stringify(typed) }, 'ut');
    expect(run).toHaveBeenCalledWith(session, 'c-sign');
  });

  it('refuses to sign or send for another address', async () => {
    const { p } = setup();
    await expect(p.request({ method: 'eth_signTypedData_v4', params: ['0x2222222222222222222222222222222222222222', '{}'] })).rejects.toMatchObject({ code: 4100 });
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ from: '0x2222222222222222222222222222222222222222', to: escrow, data: '0x' }] })).rejects.toMatchObject({ code: 4100 });
  });

  it('sends a contract call and waits for Circle to broadcast it', async () => {
    const { p, api } = setup();
    expect(await p.request({ method: 'eth_sendTransaction', params: [{ from: session.address, to: escrow, data: '0xa9059cbb' }] })).toBe('0xhash');
    expect(api).toHaveBeenCalledWith('contract-call', { walletId: 'w1', contractAddress: escrow, callData: '0xa9059cbb' }, 'ut');
    expect(api).toHaveBeenCalledWith('transaction', { walletId: 'w1', refId: 'r1' }, 'ut');
  });

  it('surfaces a failed Circle transaction', async () => {
    const api = vi.fn(async (op: string) =>
      op === 'contract-call' ? { challengeId: 'c', refId: 'r' } : { state: 'FAILED', errorReason: 'INSUFFICIENT_NATIVE_TOKEN' },
    ) as unknown as WalletsApi;
    await expect(setup({ api }).p.request({ method: 'eth_sendTransaction', params: [{ to: escrow, data: '0x' }] })).rejects.toThrow(/INSUFFICIENT_NATIVE_TOKEN/);
  });

  it('passes a cancelled approval through as a user rejection', async () => {
    const run = vi.fn(async () => Promise.reject(new ProviderRpcError(4001, 'cancelled'))) as RunChallenge;
    await expect(setup({ run }).p.request({ method: 'eth_signTypedData_v4', params: [session.address, '{}'] })).rejects.toMatchObject({ code: 4001 });
  });

  it('signs the person out when Circle says the token expired', async () => {
    const api = vi.fn(async () => Promise.reject(new WalletsApiError(401, 'expired'))) as unknown as WalletsApi;
    const { p, onExpired } = setup({ api });
    await expect(p.request({ method: 'eth_signTypedData_v4', params: [session.address, '{}'] })).rejects.toMatchObject({ code: 4100 });
    expect(onExpired).toHaveBeenCalled();
  });

  it('rejects deployments, native value, other chains and raw signing', async () => {
    const { p } = setup();
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ data: '0x60' }] })).rejects.toMatchObject({ code: -32602 });
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ to: escrow, value: '0x1' }] })).rejects.toMatchObject({ code: -32602 });
    await expect(p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })).rejects.toMatchObject({ code: 4902 });
    expect(await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x4cef52' }] })).toBeNull();
    await expect(p.request({ method: 'personal_sign', params: ['0x00', session.address] })).rejects.toMatchObject({ code: 4200 });
  });

  it('forwards reads to the Arc RPC', async () => {
    const { p, rpc } = setup();
    expect(await p.request({ method: 'eth_call', params: [{}, 'latest'] })).toBe('0xrpc');
    expect(rpc).toHaveBeenCalledWith('eth_call', [{}, 'latest']);
  });

  it('requires a session to sign', async () => {
    await expect(setup({ s: undefined }).p.request({ method: 'eth_signTypedData_v4', params: [session.address, '{}'] })).rejects.toMatchObject({ code: 4100 });
  });
});
