import type { HttpClient } from '../../lib/http-client.js';

export interface CustomerSummary {
  id: string;
  fullName: string;
  state: string;
}

export async function fetchCustomers(client: HttpClient): Promise<CustomerSummary[]> {
  return client.get<CustomerSummary[]>('/customers');
}
