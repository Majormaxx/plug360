import { describe, expect, it, vi } from 'vitest';
import { isOp, runOp, USER_ALREADY_INITIALIZED, WalletsError, type CircleClient } from '../src/index.js';

const opts = { blockchain: 'ARC-TESTNET' as const, idempotencyKey: () => 'key-1' };
const token = 'user-token';

function fakeClient(overrides: Partial<CircleClient> = {}): CircleClient {
  return {
    createDeviceTokenForSocialLogin: vi.fn(async () => ({ data: { deviceToken: 'dt', deviceEncryptionKey: 'dek' } })),
    createDeviceTokenForEmailLogin: vi.fn(async () => ({ data: { deviceToken: 'dt', deviceEncryptionKey: 'dek', otpToken: 'otp' } })),
    createUserPinWithWallets: vi.fn(async () => ({ data: { challengeId: 'ch-init' } })),
    listWallets: vi.fn(async () => ({
      data: {
        wallets: [
          { id: 'w1', address: '0x1111111111111111111111111111111111111111', blockchain: 'ARC-TESTNET', accountType: 'SCA' },
          { id: 'w2', address: '0x2222222222222222222222222222222222222222', blockchain: 'ETH-SEPOLIA', accountType: 'SCA' },
        ],
      },
    })),
    signTypedData: vi.fn(async () => ({ data: { challengeId: 'ch-sign' } })),
    createUserTransactionContractExecutionChallenge: vi.fn(async () => ({ data: { challengeId: 'ch-call' } })),
    listTransactions: vi.fn(async () => ({
      data: { transactions: [{ refId: 'other', state: 'COMPLETE', txHash: '0xother' }, { refId: 'key-1', state: 'COMPLETE', txHash: '0xabc' }] },
    })),
    ...overrides,
  };
}

const circleError = (status: number, code: number) => Object.assign(new Error('circle'), { response: { status, data: { code } } });

describe('runOp', () => {
  it('issues device tokens without a user token', async () => {
    const c = fakeClient();
    expect(await runOp(c, 'social-token', { deviceId: 'd1' }, undefined, opts)).toEqual({ deviceToken: 'dt', deviceEncryptionKey: 'dek' });
    expect(c.createDeviceTokenForSocialLogin).toHaveBeenCalledWith({ deviceId: 'd1', idempotencyKey: 'key-1' });
    expect(await runOp(c, 'email-token', { deviceId: 'd1', email: 'a@b.co' }, undefined, opts)).toMatchObject({ otpToken: 'otp' });
  });

  it('creates smart wallets on Arc when a user first signs in', async () => {
    const c = fakeClient();
    expect(await runOp(c, 'init', {}, token, opts)).toEqual({ challengeId: 'ch-init' });
    expect(c.createUserPinWithWallets).toHaveBeenCalledWith({ userToken: token, blockchains: ['ARC-TESTNET'], accountType: 'SCA', idempotencyKey: 'key-1' });
  });

  it('treats an already-initialized user as a normal sign-in', async () => {
    const c = fakeClient({ createUserPinWithWallets: vi.fn(async () => Promise.reject(circleError(409, USER_ALREADY_INITIALIZED))) });
    expect(await runOp(c, 'init', {}, token, opts)).toEqual({});
  });

  it('lists only wallets on the configured chain', async () => {
    const r = await runOp(fakeClient(), 'wallets', {}, token, opts);
    expect(r.wallets.map((w) => w.id)).toEqual(['w1']);
  });

  it('turns signing and contract calls into challenges, never signatures', async () => {
    const c = fakeClient();
    const typed = JSON.stringify({ domain: {}, types: {}, primaryType: 'Terms', message: {} });
    expect(await runOp(c, 'sign-typed-data', { walletId: 'w1', data: typed }, token, opts)).toEqual({ challengeId: 'ch-sign' });
    expect(await runOp(c, 'contract-call', { walletId: 'w1', contractAddress: '0x3df58eFFC292D5043075d71e6705dF6b7348171D', callData: '0xa9059cbb' }, token, opts)).toEqual({
      challengeId: 'ch-call',
      refId: 'key-1',
    });
    expect(c.createUserTransactionContractExecutionChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ callData: '0xa9059cbb', refId: 'key-1', fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } }),
    );
  });

  it('finds the transaction by the refId it was created with', async () => {
    const c = fakeClient();
    expect(await runOp(c, 'transaction', { walletId: 'w1', refId: 'key-1' }, token, opts)).toEqual({ state: 'COMPLETE', txHash: '0xabc' });
    expect(c.listTransactions).toHaveBeenCalledWith({ userToken: token, walletIds: ['w1'] });
    const pending = fakeClient({ listTransactions: vi.fn(async () => ({ data: { transactions: [{ refId: 'key-1', state: 'INITIATED' }] } })) });
    expect(await runOp(pending, 'transaction', { walletId: 'w1', refId: 'key-1' }, token, opts)).toEqual({ state: 'INITIATED' });
  });

  it('reports NOT_FOUND before the user approves the challenge', async () => {
    const none = fakeClient({ listTransactions: vi.fn(async () => ({ data: { transactions: [] } })) });
    expect(await runOp(none, 'transaction', { walletId: 'w1', refId: 'nope' }, token, opts)).toEqual({ state: 'NOT_FOUND' });
  });

  it('rejects bad input before calling Circle', async () => {
    const c = fakeClient();
    const cases: Array<[Parameters<typeof runOp>[1], unknown]> = [
      ['email-token', { deviceId: 'd', email: 'not-an-email' }],
      ['contract-call', { walletId: 'w', contractAddress: '0x12', callData: '0x' }],
      ['contract-call', { walletId: 'w', contractAddress: '0x3df58eFFC292D5043075d71e6705dF6b7348171D', callData: '0xabc' }],
      ['sign-typed-data', { walletId: 'w', data: 'not json' }],
    ];
    for (const [op, input] of cases) {
      await expect(runOp(c, op, input, token, opts)).rejects.toMatchObject({ status: 400 });
    }
    expect(c.createUserTransactionContractExecutionChallenge).not.toHaveBeenCalled();
    expect(c.signTypedData).not.toHaveBeenCalled();
  });

  it('requires a user token for user operations', async () => {
    await expect(runOp(fakeClient(), 'wallets', {}, undefined, opts)).rejects.toMatchObject({ status: 401 });
  });

  it('maps an expired token to 401 and other Circle failures to 502', async () => {
    const expired = fakeClient({ listWallets: vi.fn(async () => Promise.reject(circleError(401, 155104))) });
    await expect(runOp(expired, 'wallets', {}, token, opts)).rejects.toMatchObject({ status: 401, code: 155104 });
    const down = fakeClient({ listWallets: vi.fn(async () => Promise.reject(new Error('socket hang up'))) });
    const err = await runOp(down, 'wallets', {}, token, opts).catch((e) => e);
    expect(err).toBeInstanceOf(WalletsError);
    expect(err.status).toBe(502);
  });

  it('fails loudly when Circle omits a field the app needs', async () => {
    const empty = fakeClient({ signTypedData: vi.fn(async () => ({ data: {} })) });
    await expect(runOp(empty, 'sign-typed-data', { walletId: 'w', data: '{}' }, token, opts)).rejects.toMatchObject({ status: 502 });
  });
});

describe('isOp', () => {
  it('knows the contract operations only', () => {
    expect(isOp('init')).toBe(true);
    expect(isOp('constructor')).toBe(false);
    expect(isOp('__proto__')).toBe(false);
  });
});
