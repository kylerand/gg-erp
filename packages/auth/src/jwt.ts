import { createHmac } from 'node:crypto';

export interface JwtPayload {
  sub: string;
  roles: string[];
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signJwt(payload: JwtPayload, secret: string): string {
  if (!secret) {
    throw new Error('JWT secret is required');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('Invalid JWT format');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  if (expectedSignature !== signature) {
    throw new Error('Invalid JWT signature');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error('JWT expired');
  }

  return payload;
}

export type CognitoTokenUse = 'access' | 'id';

export interface CognitoJwtValidationOptions {
  issuer: string;
  audience: string | readonly string[];
  tokenUse?: CognitoTokenUse;
  clockSkewSeconds?: number;
  now?: number | Date;
}

export interface CognitoJwtClaims {
  sub: string;
  email?: string;
  iss: string;
  tokenUse: CognitoTokenUse;
  audience: string;
  clientId?: string;
  exp: number;
  iat: number;
  groups: string[];
  orgId?: string;
  shopId?: string;
}

type ClaimMap = Record<string, unknown>;

function readRequiredStringClaim(claims: ClaimMap, claimName: string): string {
  const value = claims[claimName];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing JWT claim: ${claimName}`);
  }

  return value.trim();
}

function readOptionalStringClaim(claims: ClaimMap, claimName: string): string | undefined {
  const value = claims[claimName];
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readNumericClaim(claims: ClaimMap, claimName: string): number {
  const value = claims[claimName];
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;

  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid JWT claim: ${claimName}`);
  }

  return Math.trunc(numeric);
}

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeExpectedAudience(value: string | readonly string[]): Set<string> {
  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = rawValues.map((item) => item.trim()).filter((item) => item.length > 0);

  if (normalized.length === 0) {
    throw new Error('JWT audience is required');
  }

  return new Set(normalized);
}

function normalizeAudienceCandidates(claims: ClaimMap): string[] {
  const candidates = new Set<string>();
  const audClaim = claims.aud;

  if (typeof audClaim === 'string' && audClaim.trim().length > 0) {
    candidates.add(audClaim.trim());
  } else if (Array.isArray(audClaim)) {
    for (const candidate of audClaim) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        candidates.add(candidate.trim());
      }
    }
  }

  const clientId = readOptionalStringClaim(claims, 'client_id');
  if (clientId) {
    candidates.add(clientId);
  }

  return [...candidates];
}

function normalizeTokenUse(value: string): CognitoTokenUse {
  if (value === 'access' || value === 'id') {
    return value;
  }

  throw new Error('Invalid JWT token_use claim');
}

function normalizeGroupClaims(value: unknown): string[] {
  const groups = new Set<string>();
  const rawGroups: readonly unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  for (const entry of rawGroups) {
    if (typeof entry === 'string') {
      const normalized = entry.trim();
      if (normalized.length > 0) {
        groups.add(normalized);
      }
    }
  }

  return [...groups];
}

function readOptionalScopedClaim(claims: ClaimMap, claimNames: readonly string[]): string | undefined {
  for (const claimName of claimNames) {
    const value = readOptionalStringClaim(claims, claimName);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function currentEpochSeconds(now?: number | Date): number {
  if (typeof now === 'number') {
    return Math.trunc(now);
  }

  if (now instanceof Date) {
    return Math.trunc(now.getTime() / 1000);
  }

  return Math.trunc(Date.now() / 1000);
}

export function normalizeCognitoJwtClaims(
  claims: Record<string, unknown>,
  options: CognitoJwtValidationOptions
): CognitoJwtClaims {
  const expectedIssuer = normalizeIssuer(options.issuer);
  if (!expectedIssuer) {
    throw new Error('JWT issuer is required');
  }

  const expectedAudiences = normalizeExpectedAudience(options.audience);
  const clockSkewSeconds = options.clockSkewSeconds ?? 0;
  if (!Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw new Error('JWT clock skew must be a non-negative integer');
  }

  const claimSet = claims as ClaimMap;
  const issuer = normalizeIssuer(readRequiredStringClaim(claimSet, 'iss'));
  if (issuer !== expectedIssuer) {
    throw new Error('Invalid JWT issuer');
  }

  const tokenUse = normalizeTokenUse(readRequiredStringClaim(claimSet, 'token_use'));
  if (options.tokenUse && tokenUse !== options.tokenUse) {
    throw new Error('Invalid JWT token_use');
  }

  const audienceCandidates = normalizeAudienceCandidates(claimSet);
  if (audienceCandidates.length === 0) {
    throw new Error('Missing JWT audience claim');
  }

  const matchedAudience = audienceCandidates.find((candidate) => expectedAudiences.has(candidate));
  if (!matchedAudience) {
    throw new Error('Invalid JWT audience');
  }

  const now = currentEpochSeconds(options.now);
  const exp = readNumericClaim(claimSet, 'exp');
  if (exp <= now - clockSkewSeconds) {
    throw new Error('JWT expired');
  }

  const iat = readNumericClaim(claimSet, 'iat');
  if (iat > now + clockSkewSeconds) {
    throw new Error('JWT iat is in the future');
  }

  return {
    sub: readRequiredStringClaim(claimSet, 'sub'),
    email: readOptionalStringClaim(claimSet, 'email'),
    iss: issuer,
    tokenUse,
    audience: matchedAudience,
    clientId: readOptionalStringClaim(claimSet, 'client_id'),
    exp,
    iat,
    groups: normalizeGroupClaims(claimSet['cognito:groups']),
    orgId: readOptionalScopedClaim(claimSet, ['custom:org_id', 'org_id', 'orgId']),
    shopId: readOptionalScopedClaim(claimSet, ['custom:shop_id', 'shop_id', 'shopId'])
  };
}
