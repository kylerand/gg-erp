'use client';

import { Amplify } from 'aws-amplify';

const isMockMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '';
const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window !== 'undefined' ? window.location.origin : '');

// Google SSO is only wired when Amplify hosting injects both the Cognito
// hosted-UI domain and the "Google" provider name. Without the domain the
// browser has nowhere to redirect for the OAuth code flow.
const googleEnabled =
  cognitoDomain !== '' && process.env.NEXT_PUBLIC_COGNITO_GOOGLE === 'Google';

if (!isMockMode && typeof window !== 'undefined') {
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
          userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
          loginWith: {
            email: true,
            ...(googleEnabled
              ? {
                  oauth: {
                    domain: cognitoDomain,
                    scopes: ['email', 'openid', 'profile'],
                    redirectSignIn: [`${appUrl}/auth/callback`],
                    redirectSignOut: [`${appUrl}/auth`],
                    responseType: 'code' as const,
                    providers: ['Google' as const],
                  },
                }
              : {}),
          },
        },
      },
    },
    { ssr: true },
  );
}

export default function ConfigureAmplifyClientSide() {
  return null;
}
