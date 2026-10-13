import { describe, expect, it } from 'vitest';
import { nextActor } from '../src/lib/dealRoom';

describe('nextActor', () => {
  it('runs seller, then plug, then buyer in the usual order', () => {
    expect(nextActor(false, 'missing', 'missing')).toBe('seller');
    expect(nextActor(false, 'valid', 'missing')).toBe('plug');
    expect(nextActor(false, 'valid', 'valid')).toBe('buyer');
  });

  it('starts with the plug claiming an open seat', () => {
    expect(nextActor(true, 'missing', 'missing')).toBe('claim');
  });

  it('asks the seller next once the plug has accepted first', () => {
    expect(nextActor(false, 'missing', 'valid')).toBe('seller');
    expect(nextActor(false, 'checking', 'valid')).toBe('seller');
  });

  it('blocks on any signature that does not match the terms', () => {
    expect(nextActor(false, 'invalid', 'valid')).toBe('blocked');
    expect(nextActor(false, 'valid', 'invalid')).toBe('blocked');
  });

  it('waits on a signature still being checked', () => {
    expect(nextActor(false, 'valid', 'checking')).toBe('plug');
  });
});
