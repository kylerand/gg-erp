import {
  getBlockedAlertsHandler,
  getReportingSnapshotHandler,
  recordBlockedAlertTriageActionHandler,
} from './handlers.js';

export const handler: typeof getReportingSnapshotHandler = (event) => {
  const path = event.path ?? event.rawPath;
  const method = event.httpMethod ?? event.requestContext?.http?.method;
  if (
    method === 'POST' &&
    /^\/reporting\/blocked-alerts\/[^/]+\/(?:acknowledge|escalate)$/.test(path ?? '')
  ) {
    return recordBlockedAlertTriageActionHandler(event);
  }
  if (path === '/reporting/blocked-alerts') {
    return getBlockedAlertsHandler(event);
  }
  return getReportingSnapshotHandler(event);
};
