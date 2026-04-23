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
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
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
  private readonly client: SecretsManagerClient;

  constructor(secretId?: string) {
    const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    this.secretId = secretId ?? `/gg-erp/${env}/qb/tokens`;
    this.client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-2',
    });
  }

  async getTokens(): Promise<QbTokens | null> {
    if (this.cached) return this.cached;

    try {
      const res = await this.client.send(
        new GetSecretValueCommand({ SecretId: this.secretId }),
      );
      if (!res.SecretString) return null;
      const parsed = JSON.parse(res.SecretString) as QbTokens;
      this.cached = parsed;
      return parsed;
    } catch (err) {
      // Missing secret on first connect isn't an error — we'll create it
      // when saveTokens is called.
      if (err instanceof ResourceNotFoundException) return null;
      return null;
    }
  }

  async saveTokens(tokens: QbTokens): Promise<void> {
    const value = JSON.stringify(tokens);
    try {
      await this.client.send(
        new PutSecretValueCommand({ SecretId: this.secretId, SecretString: value }),
      );
      this.cached = tokens;
    } catch (err) {
      // First QB connect in a fresh environment: the secret doesn't exist yet.
      // Create it inline so the user doesn't need to provision it out-of-band.
      if (err instanceof ResourceNotFoundException) {
        try {
          await this.client.send(
            new CreateSecretCommand({
              Name: this.secretId,
              SecretString: value,
              Description: 'QuickBooks OAuth tokens (auto-created on first connect)',
            }),
          );
          this.cached = tokens;
          return;
        } catch (createErr) {
          throw new Error(
            `Failed to create QB token secret in Secrets Manager: ${
              createErr instanceof Error ? createErr.message : 'unknown'
            }`,
          );
        }
      }
      throw new Error(
        `Failed to save QB tokens to Secrets Manager: ${err instanceof Error ? err.message : 'unknown'}`,
      );
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
