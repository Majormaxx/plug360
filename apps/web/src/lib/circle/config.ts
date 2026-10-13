/** Google and email sign-in turn on only when the Circle app and Google client are configured. */
export const circleConfig = {
  appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? '',
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
  emailEnabled: process.env.NEXT_PUBLIC_CIRCLE_EMAIL_LOGIN === 'true',
};

export const circleEnabled = circleConfig.appId !== '' && circleConfig.googleClientId !== '';
