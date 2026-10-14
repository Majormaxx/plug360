import { describe, expect, it, vi } from 'vitest';
import { loginErrorMessage } from '../src/lib/circle/errors';

describe('loginErrorMessage', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('keeps the text of string rejections from Circle', () => {
    expect(loginErrorMessage('Failed to receive deviceId')).toBe('Sign-in failed: Failed to receive deviceId');
  });

  it('shows the Circle code next to its message, or alone', () => {
    expect(loginErrorMessage({ code: 155706, message: 'Invalid social token' })).toBe('Invalid social token (Circle 155706)');
    expect(loginErrorMessage({ code: 155112 })).toBe('Sign-in failed (Circle 155112). Try again.');
  });

  it('keeps the friendly messages for known cases', () => {
    expect(loginErrorMessage({ code: 155140 })).toBe('Sign-in was cancelled.');
    expect(loginErrorMessage({ status: 429 })).toBe('Too many attempts. Wait a minute and try again.');
  });
});
