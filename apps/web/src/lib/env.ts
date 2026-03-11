export interface WebEnv {
  apiBaseUrl: string;
  telemetryEnabled: boolean;
}

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  const apiBaseUrl = env.WEB_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    throw new Error('WEB_API_BASE_URL is required');
  }

  return {
    apiBaseUrl,
    telemetryEnabled: env.WEB_TELEMETRY_ENABLED === 'true'
  };
}
