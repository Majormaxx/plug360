import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import type { CircleClient } from './service.js';

export * from './contract.js';
export { runOp, WalletsError, USER_ALREADY_INITIALIZED, type ArcChain, type CircleClient, type ServiceOptions } from './service.js';

/** Circle's client for user-controlled wallets. Call on the server only; the key must never reach a browser. */
export function circleClient(apiKey: string): CircleClient {
  return initiateUserControlledWalletsClient({ apiKey });
}
