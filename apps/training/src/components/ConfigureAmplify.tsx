'use client';

import { Amplify } from 'aws-amplify';

const isMockMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

if (!isMockMode && typeof window !== 'undefined') {
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
          userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
          loginWith: { email: true },
        },
      },
    },
    { ssr: true },
  );
}

export function ConfigureAmplify() {
  return null;
}
