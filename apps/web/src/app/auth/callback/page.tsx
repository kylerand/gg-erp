'use client';

import { useEffect, useState } from 'react';
import { Hub } from 'aws-amplify/utils';
// Importing `signInWithRedirect` even though we don't call it here: in
// Amplify v6 the OAuth response handler is registered as a side-effect of
// loading that module. Without this import, webpack tree-shaking can drop
// it from the callback bundle (we only call fetchAuthSession), and the
// page loads with `?code=` in the URL but no listener processes it — so
// Amplify never starts the token exchange and the page hangs at attempt 1
// of the poll. Run #32's diagnostics revealed exactly this pattern.
import { fetchAuthSession, signInWithRedirect as _ensureOAuthHandler } from 'aws-amplify/auth';
void _ensureOAuthHandler;

// Cognito's OAuth code flow returns here with ?code=...&state=... — Amplify's
// oauth listener picks it up automatically and exchanges for tokens. Hub events
// can fire before or after this component mounts, so we poll fetchAuthSession
// directly (the Hub listener is a belt-and-suspenders for the error case).

const POLL_INTERVAL_MS = 250;
const PER_CALL_TIMEOUT_MS = 2_000;
const POLL_TIMEOUT_MS = 10_000;
const HARD_DEADLINE_MS = 12_000;

/** Race a promise against a timeout — never blocks longer than `ms`. */
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

    // Hard deadline: regardless of what the poll loop is doing, surface an
    // error after this elapses. Defends against any path where the loop
    // ends up not iterating (e.g. a single fetchAuthSession that hangs
    // forever and outlasts even our per-call timeout, or the JS engine
    // queueing setTimeout starvation).
    const hardTimeout = setTimeout(() => {
      if (!cancelled) {
        setError('Sign-in took too long. Please try again.');
      }
    }, HARD_DEADLINE_MS);

    // eslint-disable-next-line no-console
    console.info('[auth/callback] mounted', {
      url: window.location.href,
      hasCode: window.location.search.includes('code='),
      hasState: window.location.search.includes('state='),
    });

    // Log every auth Hub event, not just failures — without this we have
    // no visibility into whether Amplify even started the OAuth exchange.
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.info(`[auth/callback] Hub.${payload.event}`, payload);
      if (payload.event === 'signInWithRedirect_failure') {
        const msg =
          (payload as { data?: { error?: { message?: string } } })?.data?.error?.message ??
          'Google sign-in failed';
        setError(msg);
      }
    });

    const start = Date.now();
    let attempts = 0;
    let lastError: unknown;
    const poll = async (): Promise<void> => {
      while (!cancelled && Date.now() - start < POLL_TIMEOUT_MS) {
        attempts += 1;
        const session = await withTimeout(
          fetchAuthSession().catch((err) => {
            lastError = err;
            return null;
          }),
          PER_CALL_TIMEOUT_MS,
        );
        if (attempts === 1 || attempts % 4 === 0) {
          // eslint-disable-next-line no-console
          console.info(
            `[auth/callback] attempt ${attempts}: tokens=${!!session?.tokens?.idToken} elapsed=${Date.now() - start}ms`,
            lastError ? { lastError } : '',
          );
        }
        if (session?.tokens?.idToken) {
          if (!cancelled) window.location.replace('/');
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled && !error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[auth/callback] timed out after ${attempts} attempts / ${Date.now() - start}ms`,
          lastError ? { lastError } : '',
        );
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
