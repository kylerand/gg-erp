export interface DatabaseConnectionConfig {
  databaseUrl: string;
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DB_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DB_DATABASE_URL is required');
  }
  return databaseUrl;
}

export function createDatabaseConnectionConfig(
  env: NodeJS.ProcessEnv = process.env
): DatabaseConnectionConfig {
  return {
    databaseUrl: resolveDatabaseUrl(env)
  };
}
