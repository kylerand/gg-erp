import type { HttpClient } from '../../lib/http-client.js';
import type { ErpReportingSnapshot } from '@gg-erp/domain';

export type ReportingSnapshot = ErpReportingSnapshot;

export async function fetchReportingSnapshot(client: HttpClient): Promise<ReportingSnapshot> {
  return client.get<ReportingSnapshot>('/reporting/snapshot');
}
