'use client';

import { SocialLoginProvider } from '@circle-fin/w3s-pw-web-sdk/dist/src/types';
import type { EmailLoginResult, LoginCompleteCallback, SocialLoginResult } from '@circle-fin/w3s-pw-web-sdk/dist/src/types';
import { USDC } from '@plug360/shared';
import { encodeFunctionData, erc20Abi, type Hash, type PublicClient } from 'viem';
import { network } from '../config';
import { walletsApi, type WalletsApi } from './api';
import { circleConfig } from './config';
import { createCircleProvider } from './provider';
import { getDeviceId, getSdk, runChallenge } from './sdk';
export { loginErrorMessage } from './errors';
import { saveSession, type CircleSession } from './session';

export type LoginStep = 'idle' | 'redirecting' | 'code' | 'signing-in' | 'creating' | 'activating' | 'done' | 'error';
export type LoginStatus = { step: LoginStep; message?: string };

let status: LoginStatus = { step: 'idle' };
const listeners = new Set<() => void>();
export const loginStatus = {
  get: () => status,
  set(next: LoginStatus) {
    status = next;
    listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const PENDING = 'plug360:circle-pending';
type Pending = { deviceToken: string; deviceEncryptionKey: string };

const googleConfig = () => ({ clientId: circleConfig.googleClientId, redirectUri: window.location.origin, selectAccountPrompt: true });

/** Starts Google sign-in. The page leaves for Google and comes back to resumeGoogleLogin. */
export async function startGoogleLogin(): Promise<void> {
  loginStatus.set({ step: 'redirecting' });
  const deviceId = await getDeviceId();
  const tokens = await walletsApi('social-token', { deviceId });
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ ...tokens, returnTo: window.location.pathname + window.location.hash }));
  } catch {
    // Without storage the redirect cannot be resumed; Circle's callback below still covers same-page flows.
  }
  const sdk = await getSdk({ ...tokens, google: googleConfig() });
  await sdk.performLogin(SocialLoginProvider.GOOGLE);
}

/** Sends a one-time code to `email` and opens Circle's code window. Resolves when sign-in completes. */
export async function startEmailLogin(email: string, publicClient: PublicClient): Promise<CircleSession> {
  loginStatus.set({ step: 'code' });
  const deviceId = await getDeviceId();
  const tokens = await walletsApi('email-token', { deviceId, email });
  const result = await new Promise<EmailLoginResult>((resolve, reject) => {
    const cb: LoginCompleteCallback = (error, r) => (error || !r ? reject(error ?? new Error('Sign-in failed')) : resolve(r));
    void getSdk({ deviceToken: tokens.deviceToken, deviceEncryptionKey: tokens.deviceEncryptionKey, otpToken: tokens.otpToken }, cb).then((s) => s.verifyOtp());
  });
  return completeLogin(result, publicClient, walletsApi, email);
}

/**
 * Called on every page load. If a Google sign-in is in flight, re-creates the SDK with the same device
 * tokens so it can read Google's response, then finishes sign-in.
 */
export async function resumeGoogleLogin(publicClient: PublicClient): Promise<{ session: CircleSession; returnTo?: string } | undefined> {
  let pending: (Pending & { returnTo?: string }) | undefined;
  try {
    const raw = sessionStorage.getItem(PENDING);
    pending = raw ? JSON.parse(raw) : undefined;
  } catch {
    pending = undefined;
  }
  if (!pending) return undefined;
  loginStatus.set({ step: 'signing-in' });
  const result = await new Promise<SocialLoginResult | EmailLoginResult>((resolve, reject) => {
    const cb: LoginCompleteCallback = (error, r) => (error || !r ? reject(error ?? new Error('Google sign-in failed')) : resolve(r));
    void getSdk({ deviceToken: pending.deviceToken, deviceEncryptionKey: pending.deviceEncryptionKey, google: googleConfig() }, cb);
  }).finally(() => {
    try {
      sessionStorage.removeItem(PENDING);
    } catch {
      // ignore
    }
  });
  const email = 'oAuthInfo' in result ? result.oAuthInfo.socialUserInfo?.email : undefined;
  const session = await completeLogin(result, publicClient, walletsApi, email);
  return { session, ...(pending.returnTo ? { returnTo: pending.returnTo } : {}) };
}

/**
 * After Circle confirms who the person is: create their Arc wallet on first sign-in, store the session,
 * and activate the wallet so the escrow can verify its signatures (a smart wallet has no code until its
 * first transaction).
 */
export async function completeLogin(
  result: { userToken: string; encryptionKey: string },
  publicClient: PublicClient,
  api: WalletsApi = walletsApi,
  email?: string,
): Promise<CircleSession> {
  const auth = { userToken: result.userToken, encryptionKey: result.encryptionKey };
  loginStatus.set({ step: 'creating' });
  const init = await api('init', {}, auth.userToken);
  if (init.challengeId) await runChallenge(auth, init.challengeId);

  let wallet: { id: string; address: string } | undefined;
  for (let i = 0; i < 20 && !wallet; i++) {
    wallet = (await api('wallets', {}, auth.userToken)).wallets[0];
    if (!wallet) await new Promise((r) => setTimeout(r, 1_000));
  }
  if (!wallet) throw new Error('Circle did not create a wallet. Try signing in again.');

  const session: CircleSession = { ...auth, walletId: wallet.id, address: wallet.address, ...(email ? { email } : {}) };
  saveSession(session);
  await activate(session, publicClient, api);
  loginStatus.set({ step: 'done' });
  return session;
}

/** The smallest possible transaction (approve 0 USDC to the escrow) deploys the wallet contract. */
export async function activate(session: CircleSession, publicClient: PublicClient, api: WalletsApi = walletsApi): Promise<Hash | undefined> {
  const code = await publicClient.getCode({ address: session.address as `0x${string}` });
  if (code && code !== '0x') return undefined;
  loginStatus.set({ step: 'activating' });
  const provider = createCircleProvider({
    chainId: network.chain.id,
    api,
    getSession: () => session,
    runChallenge,
    rpc: (method, params) => publicClient.request({ method, params } as never),
    onExpired: () => saveSession(undefined),
  });
  const hash = (await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: session.address, to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [network.escrow, 0n] }) }],
  })) as Hash;
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return hash;
}
