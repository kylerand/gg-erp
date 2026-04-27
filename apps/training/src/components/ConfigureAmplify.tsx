'use client';

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';

const isMockMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

if (!isMockMode && typeof window !== 'undefined') {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
        loginWith: { email: true },
      },
    },
  });

  // Force tokens into localStorage; see apps/web/src/components/ConfigureAmplify.tsx
  // for the explanation. Avoids the half-configured cookie storage that
  // ssr:true produces without the @aws-amplify/adapter-nextjs companion.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
}

export function ConfigureAmplify() {
  return null;
}
