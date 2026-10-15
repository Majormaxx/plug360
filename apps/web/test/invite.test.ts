import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address } from 'viem';
import { claimSeat, decodeDraft, emailHash, encodeDraft, inviteAllows, jobHash, type Draft } from '../src/lib/draft';

const escrow = '0x3df58eFFC292D5043075d71e6705dF6b7348171D' as Address;
const job = { title: 'Logo for Ada', note: '' };
const draft = (extra: Partial<Draft> = {}): Draft => ({
  chainId: 5042002,
  escrow,
  job,
  terms: {
    seller: '0x1111111111111111111111111111111111111111',
    plug: zeroAddress,
    orderId: `0x${'ab'.repeat(32)}`,
    price: 25_000_000n,
    plugFee: 0n,
    windowSeconds: 3 * 86_400,
    expiry: 2_000_000_000n,
    metadataHash: jobHash(job),
  },
  ...extra,
});

describe('plug invites by email', () => {
  const invite = { emailHash: emailHash('Kemi@Gmail.com '), name: 'Kemi' };

  it('round-trips through the link without carrying the email itself', () => {
    const link = encodeDraft(draft({ invite }));
    expect(atob(link.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('kemi@gmail.com');
    expect(decodeDraft(link, { chainId: 5042002, escrow }).invite).toEqual(invite);
  });

  it('lets only the invited email take the seat, ignoring case and spaces', () => {
    expect(inviteAllows({ invite }, 'kemi@gmail.com')).toBe(true);
    expect(inviteAllows({ invite }, ' KEMI@gmail.com')).toBe(true);
    expect(inviteAllows({ invite }, 'tobi@gmail.com')).toBe(false);
    expect(inviteAllows({ invite }, undefined)).toBe(false);
  });

  it('leaves seats without an invite open to anyone', () => {
    expect(inviteAllows({}, undefined)).toBe(true);
  });

  it('keeps the invite when the plug claims the seat', () => {
    const claimed = claimSeat(draft({ invite }), '0x2222222222222222222222222222222222222222');
    expect(claimed.invite).toEqual(invite);
  });
});
