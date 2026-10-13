import { dealEscrowAbi, MEMO, USDC, type Terms } from '@plug360/shared';
import { encodeFunctionData, encodePacked, erc20Abi, keccak256, type Address, type Hex } from 'viem';

export const multicall3FromAbi = [
  {
    type: 'function',
    name: 'aggregate3',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

export const memoAbi = [
  {
    type: 'function',
    name: 'memo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'memoId', type: 'bytes32' },
      { name: 'memoData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export type PayInput = {
  escrow: Address;
  terms: Terms;
  sellerSig: Hex;
  plugSig: Hex;
  refundTo: Address;
  /** USDC the escrow pulls: price + plugFee / 2. */
  escrowed: bigint;
};

/** Order tag Arc's Memo contract records with the payment, so the wallet history shows which deal it was. */
export function memoIdFor(orderId: Hex): Hex {
  return keccak256(encodePacked(['string', 'bytes32'], ['dealescrow:v1:', orderId]));
}

export function payCalldata(p: PayInput): Hex {
  return encodeFunctionData({ abi: dealEscrowAbi, functionName: 'pay', args: [p.terms, p.sellerSig, p.plugSig, p.refundTo] });
}

/**
 * The calls for paying in one wallet prompt through Multicall3From: approve USDC (skipped when the
 * allowance already covers it), then pay through Memo so Arc tags the transfer with the order. Only works
 * when the wallet sends from a plain EOA, because Memo and Multicall3From check tx.origin.
 */
export function oneClickCalls(p: PayInput, needsApproval: boolean) {
  const calls: { target: Address; allowFailure: boolean; callData: Hex }[] = [];
  if (needsApproval) {
    calls.push({
      target: USDC,
      allowFailure: false,
      callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [p.escrow, p.escrowed] }),
    });
  }
  calls.push({
    target: MEMO,
    allowFailure: false,
    callData: encodeFunctionData({
      abi: memoAbi,
      functionName: 'memo',
      args: [p.escrow, payCalldata(p), memoIdFor(p.terms.orderId), '0x'],
    }),
  });
  return calls;
}
