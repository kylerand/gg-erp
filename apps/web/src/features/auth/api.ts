import type { HttpClient } from '../../lib/http-client.js';

export interface AuthMeResponse {
  id: string;
  cognitoSubject: string;
  email: string;
  displayName: string;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  roles: AuthRole[];
  permissions: string[];
}

export interface AuthRole {
  code: string;
  name: string;
  permissions: AuthPermission[];
}

export interface AuthPermission {
  code: string;
  name: string;
}

export async function fetchCurrentUser(client: HttpClient): Promise<AuthMeResponse> {
  return client.get<AuthMeResponse>('/auth/me');
}
