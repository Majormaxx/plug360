import type { Op, OpError, OpInput, OpOutput } from '@plug360/wallets/contract';

export class WalletsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'WalletsApiError';
  }
}

export type WalletsApi = <O extends Op>(op: O, input: OpInput<O>, userToken?: string) => Promise<OpOutput[O]>;

/** Calls the app's /api/wallets bridge. */
export const walletsApi: WalletsApi = async (op, input, userToken) => {
  const res = await fetch(`/api/wallets/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(userToken ? { 'x-user-token': userToken } : {}) },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as OpError & OpOutput[typeof op];
  if (!res.ok) throw new WalletsApiError(res.status, body.error ?? `request failed (${res.status})`, body.code);
  return body;
};
