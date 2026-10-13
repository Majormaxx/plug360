import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  TimeoutError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from 'viem';
import { isRetryable } from '@plug360/shared';

export type ErrorKind = 'cancelled' | 'revert' | 'funds' | 'network' | 'chain' | 'timeout' | 'unknown';

export type FriendlyError = {
  kind: ErrorKind;
  title: string;
  detail?: string;
  /** Contract error name when the chain rejected the call. */
  code?: string;
};

/** Plain-language copy for every DealEscrow custom error a person can hit from the app. */
export const CONTRACT_ERRORS: Record<string, string> = {
  AlreadyDisputed: 'This deal is already in dispute.',
  AmountOutOfRange: 'The price has to be at least 1 USDC.',
  BatchTooLarge: 'Too many deals in one payout. Try fewer at a time.',
  CallerNotAllowed: 'This wallet is not allowed to do that on this deal. Check you are on the right account.',
  DeadlineAfterWindow: 'That release signature outlives the money-back window.',
  EnforcedPause: 'New deals are paused right now. Open deals can still be refunded, released and paid out.',
  ExceedsPlugLevel: "The price is over this plug's limit. Pick a plug with a higher level or lower the price.",
  FeeNotEven: 'The plug fee must split evenly between buyer and seller.',
  FeeTooHigh: 'The plug fee can be at most 5% of the price.',
  HeldCapExceeded: 'The escrow is at its total limit for now. Try a smaller amount or try again later.',
  InvalidBuyerSignature: 'The release signature does not match the buyer.',
  InvalidPlugSignature: "The plug's acceptance does not match these terms. Ask the plug to accept again.",
  InvalidRefundTo: 'Refunds cannot go to the seller or the plug.',
  InvalidSellerSignature: "The seller's signature does not match these terms. Ask the seller to sign again.",
  InvalidStatus: 'This deal has already moved on. Refresh to see where it stands.',
  NoPendingPayout: 'There is no stuck payout on this deal.',
  OrderAlreadyPaid: 'This deal has already been paid. Open the receipt to see it.',
  PlugDeadlineNotReached: 'The plug still has time to rule on this dispute.',
  PlugDeadlinePassed: 'The ruling deadline has passed. The buyer can now be refunded in full.',
  PlugNotListed: 'This plug is not listed on Plug360 yet.',
  SameParty: 'Buyer, seller and plug must be three different wallets.',
  SignatureExpired: 'That signature has expired.',
  TermsExpired: 'These terms have expired. Ask the seller for a fresh link.',
  TermsLifetimeTooLong: 'Terms can stay open for at most 30 days.',
  TransferAmountMismatch: 'USDC moved an unexpected amount. Nothing was taken; try again.',
  WindowClosed: 'The money-back window has closed, so a dispute can no longer be opened.',
  WindowOpen: 'The money-back window is still open. Payout unlocks when it ends.',
  WindowTooLong: 'The money-back window can be at most 14 days.',
  ZeroAddress: 'One of the addresses is empty.',
  ERC20InsufficientBalance: 'Not enough USDC in this wallet.',
  ERC20InsufficientAllowance: 'The escrow was not approved to take this much USDC.',
};

/** Turns anything thrown by wagmi, viem or a wallet into copy a person can act on. */
export function toFriendlyError(err: unknown): FriendlyError {
  if (!(err instanceof BaseError)) {
    if (err instanceof Error && /reject|denied|cancel/i.test(err.message)) {
      return { kind: 'cancelled', title: 'You cancelled in your wallet.' };
    }
    return { kind: 'unknown', title: 'Something went wrong.', detail: err instanceof Error ? err.message : String(err) };
  }

  const walked = (pred: (e: unknown) => boolean) => err.walk(pred);

  if (walked((e) => e instanceof UserRejectedRequestError || (e as { code?: unknown })?.code === 4001)) {
    return { kind: 'cancelled', title: 'You cancelled in your wallet.' };
  }

  const revert = walked((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (revert) {
    const name = revert.data?.errorName ?? revert.reason;
    if (name && CONTRACT_ERRORS[name]) return { kind: 'revert', title: CONTRACT_ERRORS[name], code: name };
    return {
      kind: 'revert',
      title: 'The contract refused this transaction.',
      ...(name ? { detail: name, code: name } : {}),
    };
  }

  if (walked((e) => e instanceof InsufficientFundsError) || /insufficient funds/i.test(err.message)) {
    return {
      kind: 'funds',
      title: 'Not enough USDC for gas.',
      detail: 'On Arc, gas is paid in USDC. Add a little USDC to this wallet and try again.',
    };
  }

  if (walked((e) => e instanceof ChainMismatchError)) {
    return { kind: 'chain', title: 'Your wallet is on another network.', detail: 'Switch to Arc and try again.' };
  }

  if (walked((e) => e instanceof WaitForTransactionReceiptTimeoutError)) {
    return {
      kind: 'timeout',
      title: "We couldn't confirm this transaction yet.",
      detail: 'It may still go through. Check again before trying a second time.',
    };
  }

  if (isRetryable(err) || walked((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) {
    return { kind: 'network', title: 'The Arc network did not respond.', detail: 'Check your connection and try again.' };
  }

  return { kind: 'unknown', title: 'Something went wrong.', detail: err.shortMessage };
}
