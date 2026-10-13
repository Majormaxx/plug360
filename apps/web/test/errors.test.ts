import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  InsufficientFundsError,
  RpcRequestError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from 'viem';
import { dealEscrowAbi } from '@plug360/shared';
import { CONTRACT_ERRORS, toFriendlyError } from '../src/lib/errors';

function revert(errorName: string) {
  const data = encodeErrorResult({ abi: dealEscrowAbi, errorName } as never);
  const cause = new ContractFunctionRevertedError({ abi: dealEscrowAbi, data, functionName: 'pay' });
  return new ContractFunctionExecutionError(cause, { abi: dealEscrowAbi, functionName: 'pay', args: [] });
}

const abiErrorNames = dealEscrowAbi.filter((x) => x.type === 'error').map((x) => x.name);

describe('toFriendlyError', () => {
  it('has copy for every custom error the escrow can revert with', () => {
    const internal = new Set([
      'ReentrancyGuardReentrantCall',
      'SafeERC20FailedOperation',
      'OwnableInvalidOwner',
      'OwnableUnauthorizedAccount',
      'InvalidShortString',
      'StringTooLong',
      'ExpectedPause',
      'InvalidLevel',
      'NothingToSweep',
      'RenounceDisabled',
    ]);
    const missing = abiErrorNames.filter((n) => !internal.has(n) && !CONTRACT_ERRORS[n]);
    expect(missing).toEqual([]);
  });

  it.each(['OrderAlreadyPaid', 'WindowClosed', 'ExceedsPlugLevel', 'CallerNotAllowed'])('decodes %s', (name) => {
    const f = toFriendlyError(revert(name));
    expect(f).toMatchObject({ kind: 'revert', code: name, title: CONTRACT_ERRORS[name] });
  });

  it('treats a wallet rejection as a cancel, not an error', () => {
    const e = new UserRejectedRequestError(new Error('User denied transaction signature'));
    expect(toFriendlyError(e).kind).toBe('cancelled');
    expect(toFriendlyError(new Error('User rejected the request.')).kind).toBe('cancelled');
    expect(toFriendlyError(new RpcRequestError({ body: {}, url: 'x', error: { code: 4001, message: 'nope' } })).kind).toBe('cancelled');
  });

  it('explains gas in USDC when funds run out', () => {
    expect(toFriendlyError(new InsufficientFundsError()).kind).toBe('funds');
  });

  it('flags a missing receipt as unknown outcome, never as failure', () => {
    expect(toFriendlyError(new WaitForTransactionReceiptTimeoutError({ hash: `0x${'1'.repeat(64)}` })).kind).toBe('timeout');
  });

  it('maps HTTP failures and rate limits to network', () => {
    expect(toFriendlyError(new HttpRequestError({ url: 'https://rpc', status: 503 })).kind).toBe('network');
    expect(toFriendlyError(new RpcRequestError({ body: {}, url: 'x', error: { code: -32005, message: 'limit' } })).kind).toBe('network');
  });

  it('falls back to a generic message with the short detail', () => {
    expect(toFriendlyError(new BaseError('weird thing'))).toMatchObject({ kind: 'unknown', detail: 'weird thing' });
    expect(toFriendlyError('string thrown')).toMatchObject({ kind: 'unknown' });
  });
});
