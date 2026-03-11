import { AuthorizationGuardError } from './authorize-permission.js';

export interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
  reason?: string;
}

export function toApiError(error: unknown): ApiErrorShape {
  if (error instanceof AuthorizationGuardError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      reason: error.reason
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      code: 'API_ERROR',
      message: error.message
    };
  }

  return {
    statusCode: 500,
    code: 'API_ERROR',
    message: 'Unknown API error'
  };
}
