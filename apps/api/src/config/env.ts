export interface CognitoEnv {
  issuer: string;
  audience: string;
  userPoolId: string;
  region: string;
  tokenUse?: 'access' | 'id';
  clockSkewSeconds?: number;
}

export interface ApiEnv {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  jwtSecret: string;
  cognito?: CognitoEnv;
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '3001');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('API_PORT must be a valid TCP port');
  }
  return parsed;
}

function readOptionalValue(env: NodeJS.ProcessEnv, field: string): string | undefined {
  const value = env[field]?.trim();
  return value ? value : undefined;
}

function parseOptionalNonNegativeInteger(
  value: string | undefined,
  fieldName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}

function loadCognitoEnv(env: NodeJS.ProcessEnv): CognitoEnv | undefined {
  const issuer = readOptionalValue(env, 'API_COGNITO_ISSUER');
  const audience = readOptionalValue(env, 'API_COGNITO_AUDIENCE');
  const userPoolId = readOptionalValue(env, 'API_COGNITO_USER_POOL_ID');
  const cognitoRegion = readOptionalValue(env, 'API_COGNITO_REGION');
  const tokenUseValue = readOptionalValue(env, 'API_COGNITO_TOKEN_USE');
  const clockSkewSeconds = parseOptionalNonNegativeInteger(
    readOptionalValue(env, 'API_COGNITO_CLOCK_SKEW_SECONDS'),
    'API_COGNITO_CLOCK_SKEW_SECONDS'
  );

  const hasAnyCognitoConfig = [issuer, audience, userPoolId, cognitoRegion].some(
    (value) => value !== undefined
  );
  if (!hasAnyCognitoConfig) {
    return undefined;
  }

  const region = cognitoRegion ?? readOptionalValue(env, 'AWS_REGION');

  const missingFields: string[] = [];
  if (!issuer) {
    missingFields.push('API_COGNITO_ISSUER');
  }
  if (!audience) {
    missingFields.push('API_COGNITO_AUDIENCE');
  }
  if (!userPoolId) {
    missingFields.push('API_COGNITO_USER_POOL_ID');
  }
  if (!region) {
    missingFields.push('API_COGNITO_REGION (or AWS_REGION)');
  }
  if (missingFields.length > 0) {
    throw new Error(`Incomplete Cognito config. Missing fields: ${missingFields.join(', ')}`);
  }

  if (!issuer || !audience || !userPoolId || !region) {
    throw new Error('Incomplete Cognito config');
  }

  if (!issuer.startsWith('https://')) {
    throw new Error('API_COGNITO_ISSUER must start with https://');
  }

  if (tokenUseValue && tokenUseValue !== 'access' && tokenUseValue !== 'id') {
    throw new Error('API_COGNITO_TOKEN_USE must be either access or id');
  }

  const tokenUse = tokenUseValue as CognitoEnv['tokenUse'];

  return {
    issuer,
    audience,
    userPoolId,
    region,
    tokenUse,
    clockSkewSeconds
  };
}

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const nodeEnv = (env.NODE_ENV ?? 'development') as ApiEnv['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const jwtSecret = env.API_JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('API_JWT_SECRET is required');
  }

  const cognito = loadCognitoEnv(env);

  return {
    nodeEnv,
    apiPort: parsePort(env.API_PORT),
    jwtSecret,
    cognito
  };
}
