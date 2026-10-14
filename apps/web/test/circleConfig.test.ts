import { describe, expect, it } from 'vitest';
import { resolveCircle } from '../src/lib/circle/config';

describe('resolveCircle', () => {
  it('turns email sign-in on without a Google client', () => {
    const c = resolveCircle({ appId: 'app', emailLogin: 'true' });
    expect(c).toMatchObject({ emailEnabled: true, googleEnabled: false, enabled: true });
  });

  it('turns Google sign-in on without email', () => {
    const c = resolveCircle({ appId: 'app', googleClientId: 'x.apps.googleusercontent.com' });
    expect(c).toMatchObject({ emailEnabled: false, googleEnabled: true, enabled: true });
  });

  it('stays off without the Circle app, whatever else is set', () => {
    const c = resolveCircle({ appId: ' ', googleClientId: 'g', emailLogin: 'true' });
    expect(c).toMatchObject({ emailEnabled: false, googleEnabled: false, enabled: false });
  });

  it('only accepts the exact "true" flag for email', () => {
    expect(resolveCircle({ appId: 'app', emailLogin: '1' }).enabled).toBe(false);
    expect(resolveCircle({ appId: 'app', emailLogin: '' }).enabled).toBe(false);
  });
});
