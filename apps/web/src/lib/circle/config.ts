type CircleEnv = { appId?: string; googleClientId?: string; emailLogin?: string };

/**
 * Google and email sign-in each turn on independently: both need the Circle app, Google also needs its
 * OAuth client, and email needs SMTP set up in Circle's console (signalled by the email flag).
 */
export function resolveCircle(env: CircleEnv) {
  const appId = env.appId?.trim() ?? '';
  const googleClientId = env.googleClientId?.trim() ?? '';
  const googleEnabled = appId !== '' && googleClientId !== '';
  const emailEnabled = appId !== '' && env.emailLogin?.trim() === 'true';
  return { appId, googleClientId, googleEnabled, emailEnabled, enabled: googleEnabled || emailEnabled };
}

// Next inlines NEXT_PUBLIC_ values only where they are read literally, so they are passed in one by one.
export const circleConfig = resolveCircle({
  appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID,
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  emailLogin: process.env.NEXT_PUBLIC_CIRCLE_EMAIL_LOGIN,
});

export const circleEnabled = circleConfig.enabled;
