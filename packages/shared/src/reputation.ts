import type { Address } from 'viem';

// ---------------------------------------------------------------------------
// Tier 1 — on-chain provable stats, derived from contract events by the keeper
// ---------------------------------------------------------------------------

export type PlugStats = {
  address: Address;
  /** Total deals where this plug was named. */
  totalDeals: number;
  /** Deals funded in the last 90 days. */
  recentDeals: number;
  /** Total USDC refereed (6-decimal base units). */
  totalUsdcRefereed: string;
  /** Deals that went to dispute. */
  totalDisputes: number;
  /** Disputes the plug ruled for the buyer. */
  ruledForBuyer: number;
  /** Disputes the plug ruled for the seller. */
  ruledForSeller: number;
  /** Disputes where the plug did not rule in time (timeout). */
  timedOut: number;
  /** Median hours between DisputeOpened and PlugRuled (null when no disputes ruled). */
  medianRulingHours: number | null;
  /** Unix seconds of the first DealFunded event for this plug. */
  firstDealAt: number | null;
  /** Unix seconds the stats were last recomputed. */
  computedAt: number;
};

// ---------------------------------------------------------------------------
// Tier 2 — off-chain attested plug profile (IPFS JSON, signed by the plug)
// ---------------------------------------------------------------------------

export type PlugProfile = {
  /** Must equal the plug's checksum address. */
  address: Address;
  /** Display name. */
  name: string;
  /** Short bio, max 280 chars. */
  bio?: string;
  /** Deal categories the plug specialises in. */
  specialty?: string[];
  /** BCP-47 language tags, e.g. ["en", "yo"]. */
  languages?: string[];
  /** ISO 3166-1 alpha-2 country code, e.g. "NG". */
  jurisdiction?: string;
  /** Public contact methods. */
  contact?: {
    telegram?: string;
    twitter?: string;
    email?: string;
    website?: string;
  };
  /** Optional links to external profiles. */
  links?: string[];
  /** EIP-191 personal_sign of keccak256(JSON-without-signature) by the plug address. */
  signature?: string;
  /** ISO-8601 publish timestamp. */
  publishedAt?: string;
};

// ---------------------------------------------------------------------------
// Tier 3 — buyer reviews (stored in serverless DB, gated by on-chain proof)
// ---------------------------------------------------------------------------

export type Review = {
  id: string;
  dealId: string;
  plugAddress: Address;
  buyerAddress: Address;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  /** True when this review was on a deal that went to dispute. */
  wasDisputed: boolean;
  /** EIP-191 personal_sign of reviewPayload() by the buyer address. */
  signature: string;
  createdAt: number;
};

export type ReviewInput = Omit<Review, 'id' | 'createdAt'>;

/** The payload the buyer signs: a stable string derived from the review fields. */
export function reviewPayload(r: Omit<ReviewInput, 'signature'>): string {
  return `plug360-review:${r.dealId}:${r.plugAddress.toLowerCase()}:${r.buyerAddress.toLowerCase()}:${r.rating}:${r.text}`;
}

// ---------------------------------------------------------------------------
// Aggregated plug card (all three tiers merged for the UI)
// ---------------------------------------------------------------------------

export type PlugCard = {
  address: Address;
  /** Level 0 = delisted, 1-5 = active. Read from contract. */
  level: number;
  /** Max deal size for this level in USDC base units. */
  levelCap: bigint;
  stats: PlugStats | null;
  profile: PlugProfile | null;
  /** IPFS CID of the profile document, from the PlugLevelSet event calldata. */
  profileCid: string | null;
  reviews: Review[];
  /** Staked USDC amount in 6-decimal base units (from PlugStake contract). */
  staked: bigint;
  /** Pending withdrawal request. */
  withdrawRequest: { amount: bigint; unlocksAt: number } | null;
  /** Average review rating (null when no reviews). */
  avgRating: number | null;
};

// ---------------------------------------------------------------------------
// PlugStake ABI (minimal — just the functions the UI needs)
// ---------------------------------------------------------------------------

export const plugStakeAbi = [
  {
    type: 'function',
    name: 'stakeOf',
    inputs: [{ name: 'plug', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'withdrawRequest',
    inputs: [{ name: 'plug', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'unlocksAt', type: 'uint64' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'stake',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addStake',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestWithdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'completeWithdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'council',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Staked',
    inputs: [
      { name: 'plug', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawRequested',
    inputs: [
      { name: 'plug', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'unlocksAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawCompleted',
    inputs: [
      { name: 'plug', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Slashed',
    inputs: [
      { name: 'plug', type: 'address', indexed: true },
      { name: 'victim', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'dealId', type: 'bytes32', indexed: false },
      { name: 'reason', type: 'bytes32', indexed: false },
    ],
  },
] as const;
