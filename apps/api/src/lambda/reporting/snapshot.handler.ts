import {
  createReportSubscriptionHandler,
  getBlockedAlertsHandler,
  getReportingSnapshotHandler,
  listReportExportRunsHandler,
  listReportSubscriptionsHandler,
  recordBlockedAlertTriageActionHandler,
  runReportExportNowHandler,
  updateReportSubscriptionHandler,
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
  if (method === 'GET' && path === '/reporting/subscriptions') {
    return listReportSubscriptionsHandler(event);
  }
  if (method === 'POST' && path === '/reporting/subscriptions') {
    return createReportSubscriptionHandler(event);
  }
  if (method === 'PATCH' && /^\/reporting\/subscriptions\/[^/]+$/.test(path ?? '')) {
    return updateReportSubscriptionHandler(event);
  }
  if (method === 'GET' && path === '/reporting/exports') {
    return listReportExportRunsHandler(event);
  }
  if (method === 'POST' && path === '/reporting/exports/run-now') {
    return runReportExportNowHandler(event);
  }
  if (path === '/reporting/blocked-alerts') {
    return getBlockedAlertsHandler(event);
  }
  return getReportingSnapshotHandler(event);
};
