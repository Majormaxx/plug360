import { DealStatus, PLUG_WINDOW_SECONDS, type Deal } from '@plug360/shared';
import { isAddressEqual, type Address } from 'viem';

export type Role = 'buyer' | 'seller' | 'plug' | 'viewer';

export type Phase =
  | 'missing' // no deal with this id
  | 'window' // funded, buyer can still dispute
  | 'payable' // window over, anyone can pay the seller out
  | 'disputed' // plug is deciding
  | 'dispute-expired' // plug missed the 7-day deadline, buyer gets a full refund
  | 'released' // buyer or plug cleared it, anyone can pay the seller out
  | 'refunded'
  | 'settled';

export type ActionId = 'release' | 'dispute' | 'refund' | 'plugRefund' | 'plugReject' | 'withdraw' | 'finalize' | 'retry';

export type DealView = {
  phase: Phase;
  /** Unix seconds when the money-back window closes. */
  windowEndsAt: number;
  /** Unix seconds when the plug's ruling deadline passes; 0 when not disputed. */
  plugDeadline: number;
  /** Actions this role can take now, most important first. */
  actions: ActionId[];
  final: boolean;
};

export function roleOf(deal: Pick<Deal, 'buyer' | 'seller' | 'plug'>, account: Address | undefined): Role {
  if (!account) return 'viewer';
  if (isAddressEqual(account, deal.buyer)) return 'buyer';
  if (isAddressEqual(account, deal.seller)) return 'seller';
  if (isAddressEqual(account, deal.plug)) return 'plug';
  return 'viewer';
}

export function phaseOf(deal: Deal, now: number): Phase {
  switch (deal.status) {
    case DealStatus.Held:
      return now < deal.releaseAt ? 'window' : 'payable';
    case DealStatus.Disputed:
      return now < deal.disputedAt + PLUG_WINDOW_SECONDS ? 'disputed' : 'dispute-expired';
    case DealStatus.Released:
      return 'released';
    case DealStatus.Refunded:
      return 'refunded';
    case DealStatus.Settled:
      return 'settled';
    default:
      return 'missing';
  }
}

/**
 * Mirrors the contract's guards: which calls would succeed for `role` at time `now`. The chain stays the
 * judge; every write is simulated first, so a clock skew here costs a clear error, never funds.
 */
export function viewDeal(deal: Deal, role: Role, now: number): DealView {
  const phase = phaseOf(deal, now);
  const plugDeadline = deal.status === DealStatus.Disputed ? deal.disputedAt + PLUG_WINDOW_SECONDS : 0;
  const actions: ActionId[] = [];
  const add = (cond: boolean, id: ActionId) => cond && actions.push(id);

  switch (phase) {
    case 'window':
      add(role === 'buyer', 'release');
      add(role === 'buyer', 'dispute');
      add(role === 'seller', 'refund');
      break;
    case 'payable':
      add(true, 'withdraw');
      add(role === 'seller', 'refund');
      break;
    case 'disputed':
      add(role === 'plug', 'plugRefund');
      add(role === 'plug', 'plugReject');
      add(role === 'seller', 'refund');
      add(role === 'buyer', 'release');
      break;
    case 'dispute-expired':
      add(true, 'finalize');
      add(role === 'seller', 'refund');
      add(role === 'buyer', 'release');
      break;
    case 'released':
      add(true, 'withdraw');
      break;
    default:
      break;
  }
  add(deal.payoutPending, 'retry');

  return {
    phase,
    windowEndsAt: deal.releaseAt,
    plugDeadline,
    actions,
    final: phase === 'refunded' || phase === 'settled' || phase === 'missing',
  };
}

/** Who receives what when the deal pays out. Mirrors DealEscrow's split. */
export function payoutSplit(price: bigint, plugFee: bigint) {
  const buyerHalf = plugFee / 2n;
  return {
    escrowed: price + buyerHalf,
    toSeller: price - (plugFee - buyerHalf),
    toPlug: plugFee,
    /** Plug refund: the buyer gets the price back and the plug keeps the buyer's half for ruling. */
    plugRefundToBuyer: price,
    plugRefundToPlug: buyerHalf,
  };
}
