import type { Address, Hex } from 'viem';

/** Mirrors IDealEscrowTypes.Status. Refunded and Settled are final. */
export const DealStatus = {
  None: 0,
  Held: 1,
  Disputed: 2,
  Released: 3,
  Refunded: 4,
  Settled: 5,
} as const;
export type DealStatus = (typeof DealStatus)[keyof typeof DealStatus];

/** Mirrors IDealEscrowTypes.RefundReason. */
export const RefundReason = { Seller: 0, Plug: 1, Timeout: 2 } as const;
export type RefundReason = (typeof RefundReason)[keyof typeof RefundReason];

/** A deal as returned by getDeal. */
export type Deal = {
  buyer: Address;
  seller: Address;
  plug: Address;
  refundTo: Address;
  price: bigint;
  plugFee: bigint;
  paidAt: number;
  releaseAt: number;
  disputedAt: number;
  status: number;
  payoutPending: boolean;
  orderId: Hex;
  evidenceHash: Hex;
};
