/*
 * Thin Sentry wrapper for Lambda handlers.
 *
 * - No-op when `SENTRY_DSN` is unset, so local dev and any Lambda without the
 *   env var have zero runtime cost.
 * - Lazy-initialized on first handler invocation to avoid paying cold-start
 *   for Sentry's imports when no DSN is configured.
 * - Flushes with a short timeout before the handler returns so reports aren't
 *   lost when Lambda freezes the execution environment.
 */

type SentryApi = {
  init: (options: unknown) => void;
  captureException: (error: unknown, ctx?: unknown) => void;
  flush: (timeout: number) => Promise<boolean>;
};

let sentry: SentryApi | null = null;
let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // Dynamic require so the module isn't even loaded when SENTRY_DSN is unset.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@sentry/node') as SentryApi;
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      release: process.env.GIT_COMMIT_SHA ?? undefined,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
    });
    sentry = mod;
  } catch (err) {
    // Never let Sentry setup break the handler.
    console.warn('Sentry init failed; continuing without it', err);
  }
}

interface CaptureContext {
  correlationId?: string;
  requestId?: string;
  actorUserId?: string;
}

export async function captureLambdaError(error: unknown, ctx: CaptureContext): Promise<void> {
  if (!sentry) return;
  try {
    sentry.captureException(error, {
      tags: {
        correlationId: ctx.correlationId ?? 'unknown',
        requestId: ctx.requestId ?? 'unknown',
      },
      user: ctx.actorUserId ? { id: ctx.actorUserId } : undefined,
    });
    await sentry.flush(2000);
  } catch (flushErr) {
    console.warn('Sentry capture failed', flushErr);
  }
}
