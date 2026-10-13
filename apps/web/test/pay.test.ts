import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodePacked, erc20Abi, getAddress, keccak256, toHex } from 'viem';
import { dealEscrowAbi, MEMO, USDC } from '@plug360/shared';
import { memoAbi, memoIdFor, oneClickCalls, payCalldata, type PayInput } from '../src/lib/pay';

const input: PayInput = {
  escrow: getAddress('0x3df58effc292d5043075d71e6705df6b7348171d'),
  terms: {
    seller: getAddress('0x1111111111111111111111111111111111111111'),
    plug: getAddress('0x2222222222222222222222222222222222222222'),
    orderId: `0x${'cd'.repeat(32)}`,
    price: 5_000_000n,
    plugFee: 150_000n,
    windowSeconds: 3600,
    expiry: 2_000_000_000n,
    metadataHash: `0x${'ef'.repeat(32)}`,
  },
  sellerSig: `0x${'11'.repeat(65)}`,
  plugSig: `0x${'22'.repeat(65)}`,
  refundTo: getAddress('0x4444444444444444444444444444444444444444'),
  escrowed: 5_075_000n,
};

describe('memoIdFor', () => {
  it('equals keccak256(abi.encodePacked("dealescrow:v1:", orderId)) as the Arc fork test computes it', () => {
    const manual = keccak256(`${toHex('dealescrow:v1:')}${input.terms.orderId.slice(2)}`);
    expect(memoIdFor(input.terms.orderId)).toBe(manual);
    expect(memoIdFor(input.terms.orderId)).toBe(keccak256(encodePacked(['string', 'bytes32'], ['dealescrow:v1:', input.terms.orderId])));
  });
});

describe('oneClickCalls', () => {
  it('approves exactly the escrowed amount, then pays through Memo', () => {
    const calls = oneClickCalls(input, true);
    expect(calls.map((c) => c.target)).toEqual([USDC, MEMO]);
    expect(calls.every((c) => c.allowFailure === false)).toBe(true);
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.callData });
    expect(approve.args).toEqual([input.escrow, 5_075_000n]);
    const memo = decodeFunctionData({ abi: memoAbi, data: calls[1]!.callData });
    expect(memo.args).toEqual([input.escrow, payCalldata(input), memoIdFor(input.terms.orderId), '0x']);
    const pay = decodeFunctionData({ abi: dealEscrowAbi, data: memo.args![1] });
    expect(pay.functionName).toBe('pay');
    expect(pay.args![3]).toBe(input.refundTo);
  });

  it('skips the approval when the allowance already covers it', () => {
    const calls = oneClickCalls(input, false);
    expect(calls.map((c) => c.target)).toEqual([MEMO]);
  });
});
