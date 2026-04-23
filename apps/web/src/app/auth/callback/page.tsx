'use client';

import { useEffect, useState } from 'react';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';

// Cognito's OAuth code flow returns here with ?code=...&state=... — Amplify's
// oauth listener picks it up automatically, exchanges for tokens, and fires a
// `signInWithRedirect` Hub event. We just wait for that and then navigate.

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (cancelled) return;
      switch (payload.event) {
        case 'signInWithRedirect':
        case 'signedIn':
          window.location.replace('/');
          break;
        case 'signInWithRedirect_failure': {
          const msg = (payload as { data?: { error?: { message?: string } } })?.data?.error?.message ?? 'Google sign-in failed';
          setError(msg);
          break;
        }
      }
    });

    // Amplify may have already processed the redirect before our Hub listener
    // mounted — check session directly as a fallback.
    getCurrentUser()
      .then(() => {
        if (!cancelled) window.location.replace('/');
      })
      .catch(() => {
        // Not signed in yet — Hub listener will handle it.
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#211F1E]">
      {error ? (
        <>
          <p className="text-white text-sm mb-4">{error}</p>
          <a href="/auth" className="text-[#E37125] text-sm underline">Back to sign in</a>
        </>
      ) : (
        <>
          <div className="h-10 w-10 border-4 border-[#E37125] border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-white/60 text-sm">Finishing sign-in…</p>
        </>
      )}
    </div>
  );
}
