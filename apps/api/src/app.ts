import { createApiRuntime, type ApiRuntime } from './index.js';
import { loadApiEnv, type ApiEnv } from './config/env.js';

export interface AppContext {
  env: ApiEnv;
  runtime: ApiRuntime;
}

export function createAppContext(): AppContext {
  return {
    env: loadApiEnv(),
    runtime: createApiRuntime()
  };
}
