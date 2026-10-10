import {
  encodeAbiParameters,
  formatUnits,
  hashStruct,
  hashTypedData,
  hexToBigInt,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';

/** DealEscrow limits, copied from the contract constants. All amounts are USDC base units (6 decimals). */
export const MIN_PRICE = 1_000_000n;
export const MAX_TOTAL_HELD = 2_500_000_000n;
export const MAX_WINDOW_SECONDS = 14 * 24 * 60 * 60;
export const PLUG_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const MAX_TERMS_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const MAX_FEE_BPS = 500n;
export const MAX_LEVEL = 5;
export const MAX_BATCH = 50;

const LEVEL_CAPS = [0n, 5_000_000n, 10_000_000n, 25_000_000n, 50_000_000n, 100_000_000n] as const;

/** Terms as the seller signs them. Field types follow viem's ABI mapping (uint32 -> number, uint64 -> bigint). */
export type Terms = {
  seller: Address;
  plug: Address;
  orderId: Hex;
  price: bigint;
  plugFee: bigint;
  windowSeconds: number;
  expiry: bigint;
  metadataHash: Hex;
};

export type ReleaseMessage = {
  dealId: bigint;
  buyer: Address;
  /** Escrowed total: price + plugFee / 2. Use escrowedAmount(). */
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
};

/** Which escrow a signature is for. Both values go into the EIP-712 domain. */
export type EscrowDomain = { chainId: number; escrow: Address };

export const dealEscrowTypes = {
  Terms: [
    { name: 'seller', type: 'address' },
    { name: 'plug', type: 'address' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'price', type: 'uint256' },
    { name: 'plugFee', type: 'uint256' },
    { name: 'windowSeconds', type: 'uint32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'metadataHash', type: 'bytes32' },
  ],
  Accept: [
    { name: 'termsHash', type: 'bytes32' },
    { name: 'plug', type: 'address' },
  ],
  Release: [
    { name: 'dealId', type: 'uint256' },
    { name: 'buyer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function dealEscrowDomain({ chainId, escrow }: EscrowDomain) {
  return { name: 'DealEscrow', version: '1', chainId, verifyingContract: escrow } as const;
}

/** Typed data the seller signs. Pass straight to viem's signTypedData. */
export function termsTypedData(domain: EscrowDomain, terms: Terms) {
  return {
    domain: dealEscrowDomain(domain),
    types: { Terms: dealEscrowTypes.Terms },
    primaryType: 'Terms',
    message: terms,
  } as const;
}

/** Typed data the plug signs to accept a set of terms. */
export function acceptTypedData(domain: EscrowDomain, terms: Terms) {
  return {
    domain: dealEscrowDomain(domain),
    types: { Accept: dealEscrowTypes.Accept },
    primaryType: 'Accept',
    message: { termsHash: termsHash(terms), plug: terms.plug },
  } as const;
}

/** Typed data the buyer signs for an early release that anyone can relay. */
export function releaseTypedData(domain: EscrowDomain, message: ReleaseMessage) {
  return {
    domain: dealEscrowDomain(domain),
    types: { Release: dealEscrowTypes.Release },
    primaryType: 'Release',
    message,
  } as const;
}

/** EIP-712 struct hash of the terms (no domain). The plug's Accept signs over this value. */
export function termsHash(terms: Terms): Hex {
  return hashStruct({ data: terms, primaryType: 'Terms', types: { Terms: dealEscrowTypes.Terms } });
}

export function termsDigest(domain: EscrowDomain, terms: Terms): Hex {
  return hashTypedData(termsTypedData(domain, terms));
}

export function acceptDigest(domain: EscrowDomain, termsHashValue: Hex, plug: Address): Hex {
  return hashTypedData({
    domain: dealEscrowDomain(domain),
    types: { Accept: dealEscrowTypes.Accept },
    primaryType: 'Accept',
    message: { termsHash: termsHashValue, plug },
  });
}

export function releaseDigest(domain: EscrowDomain, message: ReleaseMessage): Hex {
  return hashTypedData(releaseTypedData(domain, message));
}

/** Deal id for a (seller, orderId) pair: uint256(keccak256(abi.encode(seller, orderId))). */
export function dealIdOf(seller: Address, orderId: Hex): bigint {
  return hexToBigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [seller, orderId])));
}

/** USDC the buyer escrows: price plus the buyer's half of the plug fee. */
export function escrowedAmount(price: bigint, plugFee: bigint): bigint {
  return price + plugFee / 2n;
}

/** Splits the plug fee the way the contract does: the buyer pays floor(f/2), the seller the rest. */
export function splitFee(plugFee: bigint): { buyerHalf: bigint; sellerHalf: bigint } {
  const buyerHalf = plugFee / 2n;
  return { buyerHalf, sellerHalf: plugFee - buyerHalf };
}

/** Largest price a plug of `level` may referee (0 for an unlisted plug). Throws for levels above 5. */
export function levelCap(level: number): bigint {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) throw new RangeError(`InvalidLevel: ${level}`);
  return LEVEL_CAPS[level] as bigint;
}

/** Contract error names validateTerms can report, plus InvalidValue for values the ABI cannot encode. */
export type TermsError =
  | 'ZeroAddress'
  | 'SameParty'
  | 'InvalidRefundTo'
  | 'PlugNotListed'
  | 'AmountOutOfRange'
  | 'ExceedsPlugLevel'
  | 'FeeTooHigh'
  | 'FeeNotEven'
  | 'WindowTooLong'
  | 'TermsExpired'
  | 'TermsLifetimeTooLong'
  | 'HeldCapExceeded'
  | 'InvalidValue';

export type TermsViolation = { error: TermsError; field: string; message: string };

export type TermsContext = {
  /** Unix seconds. Use the latest block timestamp; the contract checks against the block that includes pay. */
  now: bigint;
  /** escrow.plugLevel(terms.plug). */
  plugLevel: number;
  /** Known once a buyer is paying. Omit while the seller is drafting. */
  buyer?: Address;
  refundTo?: Address;
  /** escrow.totalHeld(). When given, the 2,500 USDC contract-wide cap is checked too. */
  totalHeld?: bigint;
};

const UINT32_MAX = 2 ** 32 - 1;
const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

function usdc(amount: bigint): string {
  return `${formatUnits(amount, 6)} USDC`;
}

/**
 * Checks terms against every funding rule DealEscrow.pay enforces, so a UI can block a draft before
 * anyone signs. Returns all violations (empty when the terms would pass); the contract reverts on the
 * first one it meets. Checks that need the buyer or refund address run only when those are given.
 */
export function validateTerms(terms: Terms, ctx: TermsContext): TermsViolation[] {
  const out: TermsViolation[] = [];
  const add = (error: TermsError, field: string, message: string) => out.push({ error, field, message });

  // Shape: values the ABI encoder would reject outright.
  for (const field of ['seller', 'plug'] as const) {
    if (!isAddress(terms[field], { strict: false })) add('InvalidValue', field, `${field} is not an address`);
  }
  for (const field of ['orderId', 'metadataHash'] as const) {
    if (!isHex(terms[field], { strict: true }) || terms[field].length !== 66) {
      add('InvalidValue', field, `${field} must be 32 bytes of hex`);
    }
  }
  if (terms.price < 0n || terms.price > UINT256_MAX) add('InvalidValue', 'price', 'price must be a uint256');
  if (terms.plugFee < 0n || terms.plugFee > UINT256_MAX) add('InvalidValue', 'plugFee', 'plugFee must be a uint256');
  if (!Number.isInteger(terms.windowSeconds) || terms.windowSeconds < 0 || terms.windowSeconds > UINT32_MAX) {
    add('InvalidValue', 'windowSeconds', 'windowSeconds must be a uint32');
  }
  if (terms.expiry < 0n || terms.expiry > UINT64_MAX) add('InvalidValue', 'expiry', 'expiry must be a uint64');
  if (ctx.buyer !== undefined && !isAddress(ctx.buyer, { strict: false })) {
    add('InvalidValue', 'buyer', 'buyer is not an address');
  }
  if (ctx.refundTo !== undefined && !isAddress(ctx.refundTo, { strict: false })) {
    add('InvalidValue', 'refundTo', 'refundTo is not an address');
  }
  if (out.length > 0) return out;

  const same = (a: Address, b: Address) => isAddressEqual(a, b);
  const { seller, plug } = terms;
  const { buyer, refundTo } = ctx;

  // ZeroAddress
  if (same(seller, zeroAddress)) add('ZeroAddress', 'seller', 'seller is the zero address');
  if (same(plug, zeroAddress)) add('ZeroAddress', 'plug', 'plug is the zero address');
  if (refundTo !== undefined && same(refundTo, zeroAddress)) {
    add('ZeroAddress', 'refundTo', 'refund address is the zero address');
  }

  // SameParty
  if (same(plug, seller)) add('SameParty', 'plug', 'the plug cannot be the seller');
  if (buyer !== undefined) {
    if (same(plug, buyer)) add('SameParty', 'plug', 'the plug cannot be the buyer');
    if (same(seller, buyer)) add('SameParty', 'seller', 'the seller cannot be the buyer');
  }

  // InvalidRefundTo
  if (refundTo !== undefined && (same(refundTo, seller) || same(refundTo, plug))) {
    add('InvalidRefundTo', 'refundTo', 'refunds cannot go to the seller or the plug');
  }

  // Plug level and price
  const cap = levelCap(ctx.plugLevel);
  if (ctx.plugLevel === 0) add('PlugNotListed', 'plug', 'this plug is not listed');
  if (terms.price < MIN_PRICE) add('AmountOutOfRange', 'price', `price must be at least ${usdc(MIN_PRICE)}`);
  if (ctx.plugLevel > 0 && terms.price > cap) {
    add('ExceedsPlugLevel', 'price', `a level ${ctx.plugLevel} plug can referee up to ${usdc(cap)}`);
  }

  // Fee
  if (terms.plugFee > terms.price || terms.plugFee * 10_000n > terms.price * MAX_FEE_BPS) {
    add('FeeTooHigh', 'plugFee', 'the plug fee can be at most 5% of the price');
  }
  if (terms.plugFee % 2n !== 0n) add('FeeNotEven', 'plugFee', 'the plug fee must be an even number of base units');

  // Window and expiry
  if (terms.windowSeconds > MAX_WINDOW_SECONDS) {
    add('WindowTooLong', 'windowSeconds', 'the money-back window can be at most 14 days');
  }
  if (ctx.now >= terms.expiry) add('TermsExpired', 'expiry', 'these terms have expired');
  if (terms.expiry > ctx.now + BigInt(MAX_TERMS_LIFETIME_SECONDS)) {
    add('TermsLifetimeTooLong', 'expiry', 'terms can stay open for at most 30 days');
  }

  // Contract-wide cap
  if (ctx.totalHeld !== undefined && ctx.totalHeld + escrowedAmount(terms.price, terms.plugFee) > MAX_TOTAL_HELD) {
    add('HeldCapExceeded', 'price', `the escrow can hold at most ${usdc(MAX_TOTAL_HELD)} in total`);
  }

  return out;
}
