import { getBlockedAlertsHandler, getReportingSnapshotHandler } from './handlers.js';

export const handler: typeof getReportingSnapshotHandler = (event) => {
  const path = event.path ?? event.rawPath;
  if (path === '/reporting/blocked-alerts') {
    return getBlockedAlertsHandler(event);
  }
  return getReportingSnapshotHandler(event);
};
