import { describe, expect, it } from 'vitest';
import { displayName } from '../src/lib/circle/session';

describe('displayName', () => {
  it('uses the first name from Google', () => {
    expect(displayName({ name: 'Emerson Daniel', email: 'emersondaniel300@gmail.com' })).toBe('Emerson');
  });
  it('falls back to the part of the email before @', () => {
    expect(displayName({ email: 'ada.bakes@gmail.com' })).toBe('ada.bakes');
  });
  it('gives nothing for wallet-app users, so the header shows the address', () => {
    expect(displayName(undefined)).toBeUndefined();
    expect(displayName({ name: '  ' })).toBeUndefined();
  });
});
