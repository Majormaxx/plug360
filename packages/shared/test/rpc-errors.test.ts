import { describe, expect, it } from 'vitest';
import { BaseError, HttpRequestError, RpcRequestError } from 'viem';
import { isRangeLimit, isRetryable, rpcErrorCode } from '../src/index.js';

const rpc = (code: number, message: string) => new RpcRequestError({ body: {}, url: 'https://rpc', error: { code, message } });

describe('isRangeLimit', () => {
  it.each([
    [-32012, 'requested range too large'],
    [35, 'ranges over 10000 blocks are not supported on freetier'],
    [-32602, 'query exceeds max block range 2000'],
    [-32000, 'Request timeout on the free plan, please upgrade to paid plan'],
  ])('treats %s "%s" as a range the scan should shrink', (code, msg) => expect(isRangeLimit(rpc(code, msg))).toBe(true));

  it('leaves other failures alone', () => {
    expect(isRangeLimit(rpc(-32005, 'rate limit exceeded'))).toBe(false);
    expect(isRangeLimit(rpc(-32000, 'execution reverted'))).toBe(false);
    expect(isRangeLimit(new BaseError('unrelated'))).toBe(false);
    expect(isRangeLimit(new Error('plain'))).toBe(false);
  });
});

describe('isRetryable and rpcErrorCode', () => {
  it('retries rate limits, head lag and HTTP failures', () => {
    expect(isRetryable(rpc(-32005, 'limit'))).toBe(true);
    expect(isRetryable(rpc(-32014, 'header not found'))).toBe(true);
    expect(isRetryable(new HttpRequestError({ url: 'https://rpc', status: 502 }))).toBe(true);
    expect(isRetryable(rpc(-32000, 'You reached Public endpoint rate limit, please upgrade to paid plan'))).toBe(true);
    expect(isRetryable(rpc(-32603, 'Too Many Requests'))).toBe(true);
    expect(isRetryable(rpc(3, 'execution reverted'))).toBe(false);
  });
  it('reports the JSON-RPC code', () => {
    expect(rpcErrorCode(rpc(-32005, 'limit'))).toBe(-32005);
  });
});
