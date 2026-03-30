import assert from 'node:assert/strict';
import { describe, it, test, beforeEach } from 'node:test';
import type { QbTokens } from '../contexts/accounting/quickbooks.client.js';
import {
  QbTokenManager,
  EnvTokenStore,
} from '../contexts/accounting/quickbooks.tokenManager.js';
import {
  oauthConnectHandler,
  oauthCallbackHandler,
  processOAuthCallback,
  processQbStatus,
} from '../lambda/accounting/handlers.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'GET',
    headers: {},
    requestContext: { requestId: 'test-req-1' },
    queryStringParameters: {},
    ...overrides,
  };
}

function makeTokens(overrides: Partial<QbTokens> = {}): QbTokens {
  return {
    accessToken: 'access-abc',
    refreshToken: 'refresh-def',
    realmId: 'realm-42',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

function body(result: { body: string }): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

// ─── QbTokenManager ───────────────────────────────────────────────────────────

describe('QbTokenManager', () => {
  let store: EnvTokenStore;
  let manager: QbTokenManager;

  beforeEach(() => {
    store = new EnvTokenStore();
    manager = new QbTokenManager(store);
  });

  it('stores and retrieves tokens', async () => {
    const tokens = makeTokens();
    await manager.storeTokens(tokens);
    const retrieved = await manager.getValidTokens();
    assert.deepStrictEqual(retrieved, tokens);
  });

  it('throws QB_NOT_CONNECTED when no tokens are available', async () => {
    await assert.rejects(
      () => manager.getValidTokens(),
      { message: /QB_NOT_CONNECTED/ },
    );
  });

  it('reports not connected when no tokens stored', async () => {
    assert.equal(await manager.isConnected(), false);
  });

  it('reports connected after storing tokens', async () => {
    await manager.storeTokens(makeTokens());
    assert.equal(await manager.isConnected(), true);
  });

  it('returns valid tokens without refreshing when not expiring soon', async () => {
    const tokens = makeTokens({ expiresAt: Date.now() + 3_600_000 });
    await store.saveTokens(tokens);
    const result = await manager.getValidTokens();
    assert.equal(result.accessToken, tokens.accessToken);
  });

  it('auto-refreshes tokens when expiring within 5 minutes', async (t) => {
    await store.saveTokens(makeTokens({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      realmId: 'realm-123',
      expiresAt: Date.now() + 60_000, // 1 min — within 5-min buffer
    }));

    // Mock fetch to simulate Intuit token endpoint
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });

    const savedEnv = { id: process.env.QB_CLIENT_ID, secret: process.env.QB_CLIENT_SECRET };
    process.env.QB_CLIENT_ID = 'test-id';
    process.env.QB_CLIENT_SECRET = 'test-secret';
    t.after(() => {
      process.env.QB_CLIENT_ID = savedEnv.id;
      process.env.QB_CLIENT_SECRET = savedEnv.secret;
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }), { status: 200 })
    ) as typeof globalThis.fetch;

    const tokens = await manager.getValidTokens();

    assert.equal(tokens.accessToken, 'new-access');
    assert.equal(tokens.refreshToken, 'new-refresh');
    // realmId must be preserved from stored tokens, not from env
    assert.equal(tokens.realmId, 'realm-123');

    // Verify the refreshed tokens were persisted in the store
    const stored = await store.getTokens();
    assert.equal(stored?.accessToken, 'new-access');
    assert.equal(stored?.realmId, 'realm-123');
  });
});

// ─── processOAuthCallback ─────────────────────────────────────────────────────

describe('processOAuthCallback', () => {
  it('exchanges code, persists tokens, upserts IntegrationAccount, and redirects', async () => {
    const tokens = makeTokens();
    const storedTokens: QbTokens[] = [];
    const upsertedRealms: string[] = [];

    const result = await processOAuthCallback(
      { code: 'auth-code', realmId: 'realm-42', frontendUrl: 'http://localhost:3000' },
      {
        exchangeCode: async (_code, _realmId) => tokens,
        storeTokens: async (t) => { storedTokens.push(t); },
        upsertIntegrationAccount: async (r) => { upsertedRealms.push(r); },
      },
    );

    assert.equal(result.statusCode, 302);
    assert.ok(result.headers['Location']?.includes('connected=true'));
    assert.ok(result.headers['Location']?.includes('realmId=realm-42'));
    assert.equal(storedTokens.length, 1);
    assert.deepStrictEqual(storedTokens[0], tokens);
    assert.deepStrictEqual(upsertedRealms, ['realm-42']);
  });

  it('returns 502 when token exchange fails', async () => {
    const result = await processOAuthCallback(
      { code: 'bad-code', realmId: 'realm-42' },
      {
        exchangeCode: async () => { throw new Error('QB token exchange failed 401: invalid_grant'); },
        storeTokens: async () => {},
        upsertIntegrationAccount: async () => {},
      },
    );

    assert.equal(result.statusCode, 502);
    assert.ok(String(body(result).message).includes('invalid_grant'));
  });

  it('returns 500 when token persistence fails', async () => {
    const result = await processOAuthCallback(
      { code: 'auth-code', realmId: 'realm-42' },
      {
        exchangeCode: async () => makeTokens(),
        storeTokens: async () => { throw new Error('Secrets Manager unavailable'); },
        upsertIntegrationAccount: async () => {},
      },
    );

    assert.equal(result.statusCode, 500);
    assert.ok(String(body(result).message).includes('Secrets Manager'));
  });

  it('returns 500 when IntegrationAccount upsert fails', async () => {
    const result = await processOAuthCallback(
      { code: 'auth-code', realmId: 'realm-42' },
      {
        exchangeCode: async () => makeTokens(),
        storeTokens: async () => {},
        upsertIntegrationAccount: async () => { throw new Error('DB write failed'); },
      },
    );

    assert.equal(result.statusCode, 500);
    assert.ok(String(body(result).message).includes('DB write failed'));
  });

  it('uses fallback redirect path when frontendUrl is undefined', async () => {
    const result = await processOAuthCallback(
      { code: 'auth-code', realmId: 'realm-42' },
      {
        exchangeCode: async () => makeTokens(),
        storeTokens: async () => {},
        upsertIntegrationAccount: async () => {},
      },
    );

    assert.equal(result.statusCode, 302);
    assert.equal(result.headers['Location'], '/accounting/sync?connected=true&realmId=realm-42');
  });

  it('includes realmId and expiresAt in redirect body', async () => {
    const tokens = makeTokens({ realmId: 'realm-99' });
    const result = await processOAuthCallback(
      { code: 'c', realmId: 'realm-99', frontendUrl: 'http://app.test' },
      {
        exchangeCode: async () => tokens,
        storeTokens: async () => {},
        upsertIntegrationAccount: async () => {},
      },
    );

    const b = body(result);
    assert.equal(b.realmId, 'realm-99');
    assert.equal(b.message, 'QB connected.');
    assert.ok(typeof b.expiresAt === 'string');
  });
});

// ─── processQbStatus ──────────────────────────────────────────────────────────

describe('processQbStatus', () => {
  it('returns connected with company info when tokens are valid', async () => {
    const result = await processQbStatus({
      getValidTokens: async () => makeTokens(),
      getCompanyInfo: async () => ({ companyName: 'Test Corp', realmId: 'realm-123' }),
    });

    assert.equal(result.statusCode, 200);
    const b = body(result);
    assert.equal(b.connected, true);
    assert.equal(b.companyName, 'Test Corp');
    assert.equal(b.realmId, 'realm-123');
  });

  it('returns disconnected when no tokens available', async () => {
    const result = await processQbStatus({
      getValidTokens: async () => { throw new Error('QB_NOT_CONNECTED: No tokens'); },
      getCompanyInfo: async () => ({ companyName: '', realmId: '' }),
    });

    assert.equal(result.statusCode, 200);
    const b = body(result);
    assert.equal(b.connected, false);
    assert.ok(String(b.message).includes('QB_NOT_CONNECTED'));
  });

  it('returns disconnected when QB API call fails', async () => {
    const result = await processQbStatus({
      getValidTokens: async () => makeTokens(),
      getCompanyInfo: async () => {
        throw new Error('QB_UNAUTHORIZED: access token expired or invalid');
      },
    });

    assert.equal(result.statusCode, 200);
    const b = body(result);
    assert.equal(b.connected, false);
    assert.ok(String(b.message).includes('QB_UNAUTHORIZED'));
  });
});

// ─── OAuth Connect Handler ──────────────────────────────────────────────────

test('GET /accounting/oauth/connect returns 302 redirect to Intuit', async (t) => {
  const savedEnv = { id: process.env.QB_CLIENT_ID, uri: process.env.QB_REDIRECT_URI };
  process.env.QB_CLIENT_ID = 'test-client-id';
  process.env.QB_REDIRECT_URI = 'http://localhost:3001/accounting/oauth/callback';
  t.after(() => {
    process.env.QB_CLIENT_ID = savedEnv.id;
    process.env.QB_REDIRECT_URI = savedEnv.uri;
  });

  const res = await oauthConnectHandler(buildEvent());
  assert.equal(res.statusCode, 302);
  assert.ok(res.headers['Location']?.includes('appcenter.intuit.com'));
  assert.ok(res.headers['Location']?.includes('test-client-id'));
  assert.ok(res.headers['Set-Cookie']?.includes('qb_oauth_state='));
});

// ─── OAuth Callback Handler error paths ─────────────────────────────────────

describe('oauthCallbackHandler error paths', () => {
  it('returns 400 when QB sends error parameter', async () => {
    const res = await oauthCallbackHandler(
      buildEvent({ queryStringParameters: { error: 'access_denied' } }),
    );
    assert.equal(res.statusCode, 400);
    assert.ok(String(body(res).message).includes('access_denied'));
  });

  it('returns 400 when code is missing', async () => {
    const res = await oauthCallbackHandler(
      buildEvent({ queryStringParameters: { realmId: 'realm-42' } }),
    );
    assert.equal(res.statusCode, 400);
    assert.ok(String(body(res).message).includes('Missing code'));
  });

  it('returns 400 when realmId is missing', async () => {
    const res = await oauthCallbackHandler(
      buildEvent({ queryStringParameters: { code: 'auth-code' } }),
    );
    assert.equal(res.statusCode, 400);
    assert.ok(String(body(res).message).includes('Missing code'));
  });

  it('returns 400 when query string is empty', async () => {
    const res = await oauthCallbackHandler(buildEvent());
    assert.equal(res.statusCode, 400);
    assert.ok(String(body(res).message).includes('Missing code'));
  });
});
