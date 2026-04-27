'use client';

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';

const isMockMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '';
const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window !== 'undefined' ? window.location.origin : '');

const googleEnabled =
  cognitoDomain !== '' && process.env.NEXT_PUBLIC_COGNITO_GOOGLE === 'Google';

if (!isMockMode && typeof window !== 'undefined') {
  Amplify.configure({
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
  });

  // Force tokens into localStorage. See apps/web/src/components/ConfigureAmplify.tsx
  // for the full explanation — short version: ssr:true without the
  // @aws-amplify/adapter-nextjs companion produces a fragile cookie path
  // that fails across the Cognito redirect.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
}

export default function ConfigureAmplifyClientSide() {
  return null;
}
