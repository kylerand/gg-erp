export interface WorkerEnv {
  workerName: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxRetries: number;
  pollIntervalMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number, field: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const workerName = env.WORKER_NAME?.trim() || 'gg-erp-workers';
  const logLevel = (env.WORKER_LOG_LEVEL ?? 'info') as WorkerEnv['logLevel'];

  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error('WORKER_LOG_LEVEL must be one of debug|info|warn|error');
  }

  return {
    workerName,
    logLevel,
    maxRetries: parsePositiveInt(env.WORKER_MAX_RETRIES, 3, 'WORKER_MAX_RETRIES'),
    pollIntervalMs: parsePositiveInt(env.WORKER_POLL_INTERVAL_MS, 5000, 'WORKER_POLL_INTERVAL_MS')
  };
}
