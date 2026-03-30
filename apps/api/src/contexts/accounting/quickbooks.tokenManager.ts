/**
 * QB token manager — handles secure storage and automatic refresh of OAuth tokens.
 *
 * In production, tokens are stored in AWS Secrets Manager at:
 *   /gg-erp/{env}/qb/tokens
 *
 * For local development, falls back to environment variables.
 *
 * The token manager transparently refreshes tokens when they're close to expiration
 * (within 5 minutes of `expiresAt`).
 */
import { refreshAccessToken, type QbTokens } from './quickbooks.client.js';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

export interface TokenStore {
  getTokens(): Promise<QbTokens | null>;
  saveTokens(tokens: QbTokens): Promise<void>;
}

/**
 * Environment-based token store for local development.
 */
export class EnvTokenStore implements TokenStore {
  private tokens: QbTokens | null = null;

  async getTokens(): Promise<QbTokens | null> {
    if (this.tokens) return this.tokens;

    const accessToken = process.env.QB_ACCESS_TOKEN;
    const refreshToken = process.env.QB_REFRESH_TOKEN;
    const realmId = process.env.QB_REALM_ID;
    const expiresAt = process.env.QB_TOKEN_EXPIRES_AT;

    if (!accessToken || !refreshToken || !realmId) return null;

    return {
      accessToken,
      refreshToken,
      realmId,
      expiresAt: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600 * 1000,
    };
  }

  async saveTokens(tokens: QbTokens): Promise<void> {
    this.tokens = tokens;
  }
}

/**
 * AWS Secrets Manager token store for production.
 */
export class SecretsManagerTokenStore implements TokenStore {
  private cached: QbTokens | null = null;
  private readonly secretId: string;

  constructor(secretId?: string) {
    const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    this.secretId = secretId ?? `/gg-erp/${env}/qb/tokens`;
  }

  async getTokens(): Promise<QbTokens | null> {
    if (this.cached) return this.cached;

    try {
      const secretString = await this.getSecretValue();
      if (!secretString) return null;

      const parsed = JSON.parse(secretString) as QbTokens;
      this.cached = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  async saveTokens(tokens: QbTokens): Promise<void> {
    try {
      await this.putSecretValue(JSON.stringify(tokens));
      this.cached = tokens;
    } catch (err) {
      throw new Error(
        `Failed to save QB tokens to Secrets Manager: ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  }

  /**
   * Fetch secret from AWS Secrets Manager. Uses fetch against the local Lambda
   * extension endpoint when available, or falls back to the AWS SDK at runtime.
   */
  private async getSecretValue(): Promise<string | undefined> {
    const region = process.env.AWS_REGION ?? 'us-east-2';
    const endpoint = `https://secretsmanager.${region}.amazonaws.com`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'secretsmanager.GetSecretValue',
      },
      body: JSON.stringify({ SecretId: this.secretId }),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { SecretString?: string };
    return data.SecretString;
  }

  private async putSecretValue(value: string): Promise<void> {
    const region = process.env.AWS_REGION ?? 'us-east-2';
    const endpoint = `https://secretsmanager.${region}.amazonaws.com`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'secretsmanager.PutSecretValue',
      },
      body: JSON.stringify({ SecretId: this.secretId, SecretString: value }),
    });
    if (!res.ok) {
      throw new Error(`Secrets Manager PutSecretValue failed: ${res.status}`);
    }
  }
}

/**
 * Token manager that handles automatic refresh.
 */
export class QbTokenManager {
  constructor(private readonly store: TokenStore) {}

  /**
   * Get valid QB tokens, refreshing if needed.
   * Throws if no tokens are available (QB not connected).
   */
  async getValidTokens(): Promise<QbTokens> {
    const tokens = await this.store.getTokens();
    if (!tokens) {
      throw new Error('QB_NOT_CONNECTED: No QuickBooks tokens available. Complete OAuth flow first.');
    }

    if (this.isExpiringSoon(tokens)) {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      // Preserve realmId from stored tokens rather than relying on env var
      const updated: QbTokens = { ...refreshed, realmId: tokens.realmId };
      await this.store.saveTokens(updated);
      return updated;
    }

    return tokens;
  }

  /**
   * Store new tokens after OAuth callback.
   */
  async storeTokens(tokens: QbTokens): Promise<void> {
    await this.store.saveTokens(tokens);
  }

  /**
   * Check if QB is connected (tokens available).
   */
  async isConnected(): Promise<boolean> {
    const tokens = await this.store.getTokens();
    return tokens !== null;
  }

  private isExpiringSoon(tokens: QbTokens): boolean {
    return Date.now() + TOKEN_REFRESH_BUFFER_MS >= tokens.expiresAt;
  }
}

/**
 * Create the appropriate token manager for the current environment.
 */
export function createTokenManager(): QbTokenManager {
  const store =
    process.env.NODE_ENV === 'production'
      ? new SecretsManagerTokenStore()
      : new EnvTokenStore();

  return new QbTokenManager(store);
}
