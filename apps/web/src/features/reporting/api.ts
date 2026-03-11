import type { HttpClient } from '../../lib/http-client.js';

export interface ReportingSnapshot {
  openWorkOrders: number;
  shortageAlerts: number;
}

export async function fetchReportingSnapshot(client: HttpClient): Promise<ReportingSnapshot> {
  return client.get<ReportingSnapshot>('/reporting/snapshot');
}
