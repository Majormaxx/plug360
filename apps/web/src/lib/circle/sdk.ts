'use client';

import type { W3SSdk } from '@circle-fin/w3s-pw-web-sdk';
import type { ChallengeCompleteCallback, LoginCompleteCallback, LoginConfigs } from '@circle-fin/w3s-pw-web-sdk/dist/src/types';
import { circleConfig } from './config';
import type { RunChallenge } from './provider';
import { isCancelled } from './errors';
import { rememberWithRetry } from './retry';
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
 * Circle's SDK gets a device ID from a hidden page on pw-auth.circle.com and gives up after 10 seconds,
 * which slow connections can exceed. The ID is stable per browser, so fetch it once per visit, retry a
 * timeout (the retry is faster because the browser has cached Circle's page), and start early via warmCircle.
 */
export const getDeviceId = rememberWithRetry(
  async () => (await getSdk()).getDeviceId(),
  3,
  (attempt, err) => console.warn(`[circle-login] device ID attempt ${attempt} failed, retrying`, err),
);

/** Starts fetching the device ID ahead of a sign-in click. Errors are left for the click to report. */
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
