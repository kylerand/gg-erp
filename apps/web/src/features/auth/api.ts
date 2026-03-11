import type { HttpClient } from '../../lib/http-client.js';

export interface AuthMeResponse {
  userId: string;
  roles: string[];
}

export async function fetchCurrentUser(client: HttpClient): Promise<AuthMeResponse> {
  return client.get<AuthMeResponse>('/auth/me');
}
