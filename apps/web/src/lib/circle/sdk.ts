'use client';

import type { W3SSdk } from '@circle-fin/w3s-pw-web-sdk';
import type { ChallengeCompleteCallback, LoginCompleteCallback, LoginConfigs } from '@circle-fin/w3s-pw-web-sdk/dist/src/types';
import { circleConfig } from './config';
import type { RunChallenge } from './provider';
import { isCancelled } from './errors';
import { rememberWithRetry, withTimeout } from './retry';
import { ProviderRpcError } from './provider';

let sdk: W3SSdk | undefined;

/** Circle's web SDK touches window on construction, so it loads only in the browser, once. */
export async function getSdk(loginConfigs?: LoginConfigs, onLogin?: LoginCompleteCallback): Promise<W3SSdk> {
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const configs = { appSettings: { appId: circleConfig.appId }, ...(loginConfigs ? { loginConfigs } : {}) };
  if (!sdk) sdk = new W3SSdk(configs, onLogin);
  else if (loginConfigs || onLogin) sdk.updateConfigs(configs, onLogin);
  return sdk;
}

export { isCancelled } from './errors';

/**
 * Circle's SDK gets a device ID from a hidden page on pw-auth.circle.com and gives up after 10 seconds.
 * Slow connections can exceed that, and browsers that block third-party cookies stop the page from
 * answering at all. The ID is stable per browser, so fetch it once per visit, retry one timeout (the retry
 * is faster because Circle's page is cached by then), and start early via warmCircle.
 */
const fetchDeviceId = rememberWithRetry(
  // Circle's own 10s timer is skipped if its page answers with anything else, which can leave the call
  // hanging forever in a blocked browser, so every attempt gets a hard limit of its own.
  async () => withTimeout((async () => (await getSdk()).getDeviceId())(), 12_000, 'Failed to receive deviceId'),
  2,
  (attempt, err) => console.warn(`[circle-login] device ID attempt ${attempt} failed, retrying`, err),
);

/** Where the device check stands for this visit. Kept in memory only, so a reload checks again. */
export type DeviceCheck = 'idle' | 'checking' | 'ready' | 'blocked';
let check: DeviceCheck = 'idle';
const checkListeners = new Set<() => void>();
export const deviceCheck = {
  get: () => check,
  subscribe(fn: () => void) {
    checkListeners.add(fn);
    return () => checkListeners.delete(fn);
  },
};
const setCheck = (next: DeviceCheck) => {
  check = next;
  checkListeners.forEach((l) => l());
};

export async function getDeviceId(): Promise<string> {
  if (check !== 'ready' && check !== 'blocked') setCheck('checking');
  try {
    const id = await fetchDeviceId();
    setCheck('ready');
    return id;
  } catch (err) {
    setCheck('blocked');
    throw err;
  }
}

/** Starts the device check when sign-in opens, so a blocked browser is known before anyone clicks. */
export function warmCircle(): void {
  getDeviceId().catch(() => {});
}

/** Opens Circle's approval UI for a challenge and resolves with its outcome. */
export const runChallenge: RunChallenge = async (auth, challengeId) => {
  const s = await getSdk();
  s.setAuthentication({ userToken: auth.userToken, encryptionKey: auth.encryptionKey });
  return new Promise((resolve, reject) => {
    const done: ChallengeCompleteCallback = (error, result) => {
      if (error || !result) {
        return reject(
          isCancelled(error) ? new ProviderRpcError(4001, 'You cancelled in the Circle window') : new ProviderRpcError(-32603, error?.message ?? 'Circle could not complete the request'),
        );
      }
      if (result.status === 'FAILED' || result.status === 'EXPIRED') return reject(new ProviderRpcError(-32603, `Circle request ${result.status.toLowerCase()}`));
      const signature = (result as { data?: { signature?: string } }).data?.signature;
      resolve(signature ? { signature } : {});
    };
    s.execute(challengeId, done);
  });
};
