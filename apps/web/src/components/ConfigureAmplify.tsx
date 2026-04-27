'use client';

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';

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

  // Force tokens into localStorage. Previously we passed `{ ssr: true }`
  // to Amplify.configure, which switches token storage to cookies — but we
  // never imported `@aws-amplify/adapter-nextjs`, the companion that
  // knows how to read those cookies on the server. The half-configured
  // cookie path is fragile across the Cognito → app redirect:
  // SameSite/Secure semantics differ between auth.amazoncognito.com and
  // golfingarage.m4nos.com, and the cookie can be silently dropped, leaving
  // tokens unreadable on the next fetchAuthSession. localStorage is read
  // synchronously, survives cross-origin redirects, and is the right
  // default for a pure client-side app that never reads auth in a Server
  // Component.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
}

export default function ConfigureAmplifyClientSide() {
  return null;
}
