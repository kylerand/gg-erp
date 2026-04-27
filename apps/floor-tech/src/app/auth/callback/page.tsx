'use client';

import { useEffect, useState } from 'react';
import { Hub } from 'aws-amplify/utils';
import { fetchAuthSession } from 'aws-amplify/auth';

const POLL_INTERVAL_MS = 250;
const PER_CALL_TIMEOUT_MS = 2_000;
const POLL_TIMEOUT_MS = 10_000;
const HARD_DEADLINE_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race<T | null>([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hardTimeout = setTimeout(() => {
      if (!cancelled) {
        setError('Sign-in took too long. Please try again.');
      }
    }, HARD_DEADLINE_MS);

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (cancelled) return;
      if (payload.event === 'signInWithRedirect_failure') {
        const msg =
          (payload as { data?: { error?: { message?: string } } })?.data?.error?.message ??
          'Google sign-in failed';
        setError(msg);
      }
    });

    const start = Date.now();
    const poll = async (): Promise<void> => {
      while (!cancelled && Date.now() - start < POLL_TIMEOUT_MS) {
        const session = await withTimeout(
          fetchAuthSession().catch(() => null),
          PER_CALL_TIMEOUT_MS,
        );
        if (session?.tokens?.idToken) {
          if (!cancelled) window.location.replace('/');
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled && !error) {
        setError('Sign-in took too long. Please try again.');
      }
    };
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(hardTimeout);
      unsubscribe();
    };
  }, [error]);

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
