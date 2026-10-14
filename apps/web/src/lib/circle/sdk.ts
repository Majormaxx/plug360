'use client';

import type { W3SSdk } from '@circle-fin/w3s-pw-web-sdk';
import type { ChallengeCompleteCallback, LoginCompleteCallback, LoginConfigs } from '@circle-fin/w3s-pw-web-sdk/dist/src/types';
import { circleConfig } from './config';
import type { RunChallenge } from './provider';
import { isCancelled } from './errors';
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
