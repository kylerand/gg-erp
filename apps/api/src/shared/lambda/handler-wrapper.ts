import { randomUUID } from 'node:crypto';

export interface LambdaEvent {
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  pathParameters?: Record<string, string | undefined> | null;
  routeKey?: string;
  rawPath?: string;
  path?: string;
  httpMethod?: string;
  requestContext?: {
    requestId?: string;
    http?: { method?: string; path?: string };
    authorizer?: {
      claims?: Record<string, string>;
      jwt?: { claims?: Record<string, string> };
    };
  };
}

export interface LambdaResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface RequestContext {
  correlationId: string;
  requestId: string;
  actorUserId?: string;
  actorRoles: string[];
  event: LambdaEvent;
}

export type RouteHandler = (ctx: RequestContext) => Promise<LambdaResult>;

export interface WrapOptions {
  /** Require an authenticated actor. Responds 401 if no actor found. Default: false */
  requireAuth?: boolean;
  /** Required roles — at least one must match. Empty array = any authenticated user. */
  allowedRoles?: string[];
  /** CORS allowed origins. Default: * */
  corsOrigin?: string;
}

const DEFAULT_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,authorization,x-correlation-id,x-actor-id',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

/**
 * Wraps a route handler with:
 * - correlation ID propagation
 * - structured error boundary (prevents cold 500 leaking internals)
 * - CORS headers
 * - optional auth enforcement
 */
export function wrapHandler(handler: RouteHandler, options: WrapOptions = {}): (event: LambdaEvent) => Promise<LambdaResult> {
  return async (event: LambdaEvent): Promise<LambdaResult> => {
    const correlationId = resolveCorrelationId(event);
    const requestId = event.requestContext?.requestId ?? randomUUID();

    // OPTIONS preflight (v1: httpMethod, v2: requestContext.http.method)
    const method = event.httpMethod ?? event.requestContext?.http?.method;
    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: { ...DEFAULT_CORS_HEADERS, 'content-type': 'application/json' },
        body: '',
      };
    }

    const actorUserId = resolveActorUserId(event);
    const actorRoles = resolveActorRoles(event);

    if (options.requireAuth && !actorUserId) {
      return jsonResponse(401, { message: 'Authentication required.', correlationId });
    }

    if (options.allowedRoles && options.allowedRoles.length > 0) {
      const hasRole = actorRoles.some((r) => options.allowedRoles!.includes(r));
      if (!hasRole) {
        return jsonResponse(403, { message: 'Insufficient permissions.', correlationId });
      }
    }

    const ctx: RequestContext = {
      correlationId,
      requestId,
      actorUserId,
      actorRoles,
      event,
    };

    try {
      const result = await handler(ctx);
      return addCorsHeaders(result, options.corsOrigin);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          correlationId,
          requestId,
          message: 'Unhandled error in Lambda handler',
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        }),
      );

      return jsonResponse(500, {
        message: 'An unexpected error occurred.',
        correlationId,
      });
    }
  };
}

/** Parses the JSON body; returns ok:false on empty or invalid JSON. */
export function parseBody<T>(event: LambdaEvent): { ok: true; value: T } | { ok: false; error: string } {
  const raw = event.body;
  if (!raw?.trim()) {
    return { ok: false, error: 'Request body is required.' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, error: 'Request body must be valid JSON.' };
  }
}

/** Build a JSON response with standard headers. */
export function jsonResponse(statusCode: number, payload: unknown): LambdaResult {
  return {
    statusCode,
    headers: {
      ...DEFAULT_CORS_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}

function resolveCorrelationId(event: LambdaEvent): string {
  return (
    event.headers?.['x-correlation-id'] ??
    event.headers?.['X-Correlation-Id'] ??
    event.requestContext?.requestId ??
    randomUUID()
  );
}

function resolveActorUserId(event: LambdaEvent): string | undefined {
  // From API Gateway JWT authorizer (Cognito)
  const claims = resolveJwtClaims(event);
  if (claims?.sub) return claims.sub as string;

  // Fallback: explicit header (for dev/testing only)
  const actorHeader = event.headers?.['x-actor-id'] ?? event.headers?.['X-Actor-Id'];
  return actorHeader?.trim() || undefined;
}

function resolveActorRoles(event: LambdaEvent): string[] {
  const claims = resolveJwtClaims(event);
  if (!claims) return [];

  // Try cognito:groups first (most reliable for group-based RBAC), then custom:role
  const roleAttr = claims['cognito:groups'] || claims['custom:role'];
  if (!roleAttr) return [];

  if (typeof roleAttr !== 'string') {
    // Already an array (from decoded JWT)
    if (Array.isArray(roleAttr)) return roleAttr.map(String);
    return [];
  }

  // API GW v2 JWT authorizer serializes arrays as "[val1 val2]" (no quotes, space-separated)
  // e.g. cognito:groups becomes "[admin]" or "[admin technician]"
  if (roleAttr.startsWith('[') && roleAttr.endsWith(']')) {
    const inner = roleAttr.slice(1, -1).trim();
    if (!inner) return [];
    // Try JSON parse first (valid JSON like '["admin"]')
    try {
      return JSON.parse(roleAttr) as string[];
    } catch {
      // Fall back to space-separated (API GW v2 format like '[admin technician]')
      return inner.split(/[\s,]+/).filter(Boolean);
    }
  }

  // Plain comma-separated like 'admin,technician'
  return roleAttr.split(',').map((r) => r.trim()).filter(Boolean);
}

/** Extract JWT claims from API Gateway authorizer context or Authorization header. */
function resolveJwtClaims(event: LambdaEvent): Record<string, unknown> | undefined {
  // 1. API Gateway JWT authorizer context (preferred when authorizer is configured)
  const gwClaims =
    event.requestContext?.authorizer?.jwt?.claims ??
    event.requestContext?.authorizer?.claims;
  if (gwClaims?.sub) return gwClaims as Record<string, unknown>;

  // 2. Decode JWT from Authorization header (when routes use authorization_type = NONE)
  const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  if (!authHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return undefined;

  try {
    const parts = match[1].split('.');
    if (parts.length !== 3) return undefined;
    // Base64url-decode the payload (index 1)
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function addCorsHeaders(result: LambdaResult, corsOrigin?: string): LambdaResult {
  return {
    ...result,
    headers: {
      ...DEFAULT_CORS_HEADERS,
      ...(corsOrigin ? { 'access-control-allow-origin': corsOrigin } : {}),
      ...result.headers,
    },
  };
}
