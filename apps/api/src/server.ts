/**
 * Local development HTTP server.
 * Wraps Lambda handlers behind a plain Node.js HTTP server so you can
 * run `npm run dev:api` and hit the API with curl / Postman without deploying.
 *
 * Not used in production — production runs via API Gateway + Lambda.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadApiEnv } from './config/env.js';
import {
  createWorkOrderHandler,
  listWorkOrdersHandler,
  type ApiGatewayProxyEventLike,
} from './lambda/work-orders/handlers.js';
import {
  triggerBatchHandler,
  listBatchesHandler,
  getBatchHandler,
  cancelBatchHandler,
} from './lambda/migration/handlers.js';
import {
  listCustomersHandler,
  getCustomerHandler,
  createCustomerHandler,
  transitionCustomerStateHandler,
} from './lambda/customers/handlers.js';
import {
  listLotsHandler,
  listPartsHandler,
  getPartHandler,
  getPartChainHandler,
  createPartHandler,
  listVendorsHandler,
  listManufacturersHandler,
  listPurchaseOrdersHandler,
  createManufacturerHandler,
  planMaterialByStageHandler,
} from './lambda/inventory/handlers.js';
import {
  listTasksHandler,
  createTaskHandler,
  transitionTaskHandler,
  listReworkHandler,
  createReworkHandler,
  listInvoiceSyncHandler,
  getQcGatesHandler,
  batchSubmitQcGatesHandler,
  listTimeEntriesHandler,
  createTimeEntryHandler,
  updateTimeEntryHandler,
  deleteTimeEntryHandler,
  listWoQueueHandler,
  listAllWorkOrdersHandler,
  getWoDetailHandler,
  listAllTimeEntriesHandler,
} from './lambda/tickets/handlers.js';
import {
  listSopsHandler,
  getSopHandler,
  createSopHandler,
  publishSopVersionHandler,
  listTrainingModulesHandler,
  getTrainingModuleHandler,
  getModuleProgressHandler,
  updateStepProgressHandler,
  submitQuizHandler,
  listMyAssignmentsHandler,
  completeAssignmentHandler,
  listNotesHandler,
  upsertNoteHandler,
  deleteNoteHandler,
  listBookmarksHandler,
  toggleBookmarkHandler,
  listQuestionsHandler,
  askQuestionHandler,
  answerQuestionHandler,
  listInspectionTemplatesHandler,
  getInspectionTemplateHandler,
} from './lambda/sop/handlers.js';
import {
  listRoutingStepsHandler,
  transitionRoutingStepStateHandler,
} from './lambda/routing-steps/handlers.js';
import { getMeHandler, listEmployeesHandler } from './lambda/identity/handlers.js';
import { adminListUsersHandler } from './lambda/identity/admin-list-users.handler.js';
import { adminCreateUserHandler } from './lambda/identity/admin-create-user.handler.js';
import { adminUpdateUserHandler } from './lambda/identity/admin-update-user.handler.js';
import { adminDeleteUserHandler } from './lambda/identity/admin-delete-user.handler.js';
import { handler as listDealersHandler } from './lambda/identity/list-dealers.handler.js';
import {
  listChannelsHandler,
  createChannelHandler,
  listMessagesHandler,
  sendMessageHandler,
  listRepliesHandler,
  editMessageHandler,
  deleteMessageHandler,
  addReactionHandler,
  removeReactionHandler,
  listTodosHandler,
  createTodoHandler,
  updateTodoHandler,
  listNotificationsHandler,
  markNotificationsReadHandler,
} from './lambda/communication/handlers.js';
import {
  oauthConnectHandler,
  oauthCallbackHandler,
  qbStatusHandler,
  listInvoiceSyncsHandler,
  triggerInvoiceSyncHandler,
  retryInvoiceSyncHandler,
  listCustomerSyncsHandler,
  triggerCustomerSyncHandler,
  listReconciliationRunsHandler,
  triggerReconciliationHandler,
  getReconciliationRunHandler,
  listMismatchesHandler,
  resolveReconciliationHandler,
  listAccountsHandler,
  updateAccountStatusHandler,
  getFailureSummaryHandler,
  retryFailedHandler,
  listDimensionMappingsHandler,
  upsertDimensionMappingHandler,
  listTaxMappingsHandler,
  upsertTaxMappingHandler,
} from './lambda/accounting/handlers.js';
import {
  listOpportunitiesHandler,
  getOpportunityHandler,
  createOpportunityHandler,
  updateOpportunityHandler,
  transitionOpportunityStageHandler,
  listQuotesHandler,
  getQuoteHandler,
  createQuoteHandler,
  updateQuoteHandler,
  updateQuoteLinesHandler,
  sendQuoteHandler,
  acceptQuoteHandler,
  rejectQuoteHandler,
  listActivitiesHandler,
  createActivityHandler,
  getPipelineStatsHandler,
  getSalesForecastHandler,
  getSalesDashboardHandler,
} from './lambda/sales/handlers.js';
import { handler as salesAgentChatHandler } from './lambda/sales/agent-chat.handler.js';
import { handler as salesAgentSessionsHandler } from './lambda/sales/agent-sessions.handler.js';
import { handler as salesAgentSessionDetailHandler } from './lambda/sales/agent-session-detail.handler.js';
import { handler as copilotChatHandler } from './lambda/copilot/chat.handler.js';
import { handler as copilotSessionsHandler } from './lambda/copilot/sessions.handler.js';
import { handler as copilotSessionDetailHandler } from './lambda/copilot/session-detail.handler.js';
import { listAuditEventsHandler } from './lambda/audit/handlers.js';
import { listBuildSlotsHandler, listLaborCapacityHandler } from './lambda/scheduling/handlers.js';
import { getWorkspaceTodayHandler } from './lambda/workspace/handlers.js';

const env = loadApiEnv();
const PORT = env.apiPort;

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseQueryString(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const qs = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  qs.forEach((v, k) => { result[k] = v; });
  return result;
}

function toLambdaHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v)) out[k] = v[0] ?? '';
  }
  return out;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,authorization,x-correlation-id,x-actor-id',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

async function route(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0];

  // Handle CORS preflight globally — must respond before reading body
  if (method === 'OPTIONS') {
    res.writeHead(204, { ...CORS_HEADERS, 'content-length': '0' });
    res.end();
    return;
  }

  const body = await readBody(req);

  const event: ApiGatewayProxyEventLike = {
    body: body || null,
    headers: toLambdaHeaders(req),
    queryStringParameters: parseQueryString(rawUrl),
    httpMethod: method,
    requestContext: { requestId: `local-${Date.now()}` },
  };

  let result: Awaited<ReturnType<typeof createWorkOrderHandler>> | null = null;

  // ── Path parameter extraction helpers ────────────────────────────────────
  const migrationBatchMatch = pathname.match(/^\/migration\/batches\/([^/]+)/);
  const customerMatch = pathname.match(/^\/identity\/customers\/([^/]+)/);
  const partMatch = pathname.match(/^\/inventory\/parts\/([^/]+)(?:\/([^/]+))?/);
  const taskMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/tasks(?:\/([^/]+))?/);
  const reworkMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/rework/);
  const qcMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/qc-gates/);
  const timeEntryMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/time-entries(?:\/([^/]+))?/);
  const flatTimeEntryMatch = pathname.match(/^\/tickets\/time-entries\/([^/]+)/);
  const technicianTaskMatch = pathname.match(/^\/tickets\/technician-tasks\/([^/]+)/);
  const sopMatch = pathname.match(/^\/sop\/([^/]+)/);
  const sopModuleMatch = pathname.match(/^\/sop\/modules\/([^/]+)/);
  const sopModuleProgressMatch = pathname.match(/^\/sop\/modules\/([^/]+)\/progress\/([^/]+)/);
  const sopQuestionAnswerMatch = pathname.match(/^\/sop\/questions\/([^/]+)\/answer/);
  const sopItMatch = pathname.match(/^\/sop\/inspection-templates(?:\/([^/]+))?$/);
  const routingStepStateMatch = pathname.match(/^\/planning\/routing-steps\/([^/]+)\/state$/);
  const legacyRoutingStepMatch = pathname.match(/^\/tickets\/routing-steps\/([^/]+)/);
  const woQueueMatch = pathname.match(/^\/tickets\/wo-queue\/([^/]+)/);
  const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)/);
  const channelMessagesMatch = pathname.match(/^\/communication\/channels\/([^/]+)\/messages/);
  const channelTodosMatch = pathname.match(/^\/communication\/channels\/([^/]+)\/todos/);
  const commMessageMatch = pathname.match(/^\/communication\/messages\/([^/]+)/);
  const commMessageRepliesMatch = pathname.match(/^\/communication\/messages\/([^/]+)\/replies/);
  const commMessageReactionsMatch = pathname.match(/^\/communication\/messages\/([^/]+)\/reactions(?:\/([^/]+))?/);
  const commTodoMatch = pathname.match(/^\/communication\/todos\/([^/]+)/);
  const salesOpportunityMatch = pathname.match(/^\/sales\/opportunities\/([^/]+)/);
  const salesQuoteMatch = pathname.match(/^\/sales\/quotes\/([^/]+)/);
  const salesAgentSessionMatch = pathname.match(/^\/sales\/agent\/sessions\/([^/]+)/);
  const copilotSessionMatch = pathname.match(/^\/copilot\/sessions\/([^/]+)/);
  const ojtAssignmentMatch = pathname.match(/^\/ojt\/assignments\/([^/]+)\/complete/);
  const qbInvoiceSyncMatch = pathname.match(/^\/accounting\/(?:invoices|invoice-sync)\/([^/]+)/);
  const qbIntegrationAccountMatch = pathname.match(/^\/accounting\/integration-accounts\/([^/]+)/);
  const qbReconciliationRunMatch = pathname.match(/^\/accounting\/reconciliation\/runs\/([^/]+)/);
  const qbReconciliationRecordMatch = pathname.match(/^\/accounting\/reconciliation\/records\/([^/]+)/);

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (pathname === '/auth/me' && method === 'GET') {
    result = await getMeHandler(event);
  } else if (pathname === '/hr/employees' && method === 'GET') {
    result = await listEmployeesHandler(event);

  // ── Workspace ─────────────────────────────────────────────────────────────
  } else if (pathname === '/workspace/today' && method === 'GET') {
    result = await getWorkspaceTodayHandler(event);

  // ── Planning ──────────────────────────────────────────────────────────────
  } else if (pathname === '/planning/work-orders' && method === 'POST') {
    result = await createWorkOrderHandler(event);
  } else if (pathname === '/planning/work-orders' && method === 'GET') {
    result = await listWorkOrdersHandler(event);

  // ── Customers ─────────────────────────────────────────────────────────────
  } else if (pathname === '/identity/customers' && method === 'GET') {
    result = await listCustomersHandler(event);
  } else if (pathname === '/identity/dealers' && method === 'GET') {
    result = await listDealersHandler(event);
  } else if (pathname === '/identity/customers' && method === 'POST') {
    result = await createCustomerHandler(event);
  } else if (customerMatch && method === 'GET') {
    result = await getCustomerHandler({ ...event, pathParameters: { id: customerMatch[1] } });
  } else if (customerMatch && (
    (pathname.endsWith('/transition') && method === 'POST') ||
    (pathname.endsWith('/state') && method === 'PATCH')
  )) {
    result = await transitionCustomerStateHandler({ ...event, pathParameters: { id: customerMatch[1] } });

  // ── Inventory ─────────────────────────────────────────────────────────────
  } else if (pathname === '/inventory/parts' && method === 'GET') {
    result = await listPartsHandler(event);
  } else if (pathname === '/inventory/lots' && method === 'GET') {
    result = await listLotsHandler(event);
  } else if (pathname === '/inventory/parts' && method === 'POST') {
    result = await createPartHandler(event);
  } else if (pathname === '/inventory/planning/material-by-stage' && method === 'GET') {
    result = await planMaterialByStageHandler(event);
  } else if (pathname === '/inventory/manufacturers' && method === 'GET') {
    result = await listManufacturersHandler(event);
  } else if (pathname === '/inventory/manufacturers' && method === 'POST') {
    result = await createManufacturerHandler(event);
  } else if (pathname === '/inventory/purchase-orders' && method === 'GET') {
    result = await listPurchaseOrdersHandler(event);
  } else if (partMatch && partMatch[2] === 'chain' && method === 'GET') {
    result = await getPartChainHandler({ ...event, pathParameters: { id: partMatch[1] } });
  } else if (partMatch && !partMatch[2] && method === 'GET') {
    result = await getPartHandler({ ...event, pathParameters: { id: partMatch[1] } });
  } else if (pathname === '/inventory/vendors' && method === 'GET') {
    result = await listVendorsHandler(event);

  // ── Tickets ───────────────────────────────────────────────────────────────
  } else if (taskMatch && method === 'GET' && !taskMatch[2]) {
    result = await listTasksHandler({ ...event, pathParameters: { workOrderId: taskMatch[1] } });
  } else if (taskMatch && method === 'POST' && !taskMatch[2]) {
    result = await createTaskHandler({ ...event, pathParameters: { workOrderId: taskMatch[1] } });
  } else if (taskMatch && taskMatch[2] && method === 'POST') {
    result = await transitionTaskHandler({ ...event, pathParameters: { workOrderId: taskMatch[1], id: taskMatch[2] } });
  } else if (reworkMatch && method === 'GET') {
    result = await listReworkHandler({ ...event, pathParameters: { workOrderId: reworkMatch[1] } });
  } else if (reworkMatch && method === 'POST') {
    result = await createReworkHandler({ ...event, pathParameters: { workOrderId: reworkMatch[1] } });
  } else if (qcMatch && method === 'GET') {
    result = await getQcGatesHandler({ ...event, pathParameters: { workOrderId: qcMatch[1] } });
  } else if (qcMatch && method === 'POST') {
    result = await batchSubmitQcGatesHandler({ ...event, pathParameters: { workOrderId: qcMatch[1] } });
  } else if (timeEntryMatch && method === 'GET' && !timeEntryMatch[2]) {
    result = await listTimeEntriesHandler({ ...event, pathParameters: { workOrderId: timeEntryMatch[1] } });
  } else if (timeEntryMatch && method === 'POST' && !timeEntryMatch[2]) {
    result = await createTimeEntryHandler({ ...event, pathParameters: { workOrderId: timeEntryMatch[1] } });
  } else if (timeEntryMatch && timeEntryMatch[2] && method === 'PATCH') {
    result = await updateTimeEntryHandler({ ...event, pathParameters: { workOrderId: timeEntryMatch[1], id: timeEntryMatch[2] } });
  } else if (timeEntryMatch && timeEntryMatch[2] && method === 'DELETE') {
    result = await deleteTimeEntryHandler({ ...event, pathParameters: { workOrderId: timeEntryMatch[1], id: timeEntryMatch[2] } });
  } else if (pathname === '/tickets/time-entries' && method === 'POST') {
    result = await createTimeEntryHandler(event);
  } else if (flatTimeEntryMatch && method === 'PATCH') {
    result = await updateTimeEntryHandler({ ...event, pathParameters: { id: flatTimeEntryMatch[1] } });
  } else if (flatTimeEntryMatch && method === 'DELETE') {
    result = await deleteTimeEntryHandler({ ...event, pathParameters: { id: flatTimeEntryMatch[1] } });
  } else if (pathname === '/tickets/invoice-sync' && method === 'GET') {
    result = await listInvoiceSyncHandler(event);

  // ── Work Orders — full list (all statuses, paginated) ────────────────────
  } else if (pathname === '/tickets/work-orders' && method === 'GET') {
    result = await listAllWorkOrdersHandler(event);

  // ── Work Order Queue (floor-tech) ─────────────────────────────────────────
  } else if (pathname === '/tickets/wo-queue' && method === 'GET') {
    result = await listWoQueueHandler(event);
  } else if (woQueueMatch && method === 'GET') {
    result = await getWoDetailHandler({ ...event, pathParameters: { id: woQueueMatch[1] } });

  // ── Time Entries (flat query — no workOrderId path param) ─────────────────
  } else if (pathname === '/tickets/time-entries' && method === 'GET') {
    result = await listAllTimeEntriesHandler(event);

  } else if (pathname === '/tickets/technician-tasks' && method === 'GET') {
    result = await listTasksHandler(event);
  } else if (technicianTaskMatch && method === 'PATCH') {
    result = await transitionTaskHandler({ ...event, pathParameters: { id: technicianTaskMatch[1] } });

  } else if (pathname === '/planning/routing-steps' && method === 'GET') {
    result = await listRoutingStepsHandler(event);
  } else if (routingStepStateMatch && method === 'PATCH') {
    result = await transitionRoutingStepStateHandler({ ...event, pathParameters: { id: routingStepStateMatch[1] } });
  } else if (legacyRoutingStepMatch && method === 'GET') {
    result = await listRoutingStepsHandler({
      ...event,
      queryStringParameters: { ...(event.queryStringParameters ?? {}), workOrderId: legacyRoutingStepMatch[1] },
    });
  } else if (legacyRoutingStepMatch && method === 'PATCH') {
    result = await transitionRoutingStepStateHandler({ ...event, pathParameters: { id: legacyRoutingStepMatch[1] } });

  // ── SOP / Training ────────────────────────────────────────────────────────
  } else if (pathname === '/sop' && method === 'GET') {
    result = await listSopsHandler(event);
  } else if (pathname === '/sop' && method === 'POST') {
    result = await createSopHandler(event);
  } else if (sopMatch && pathname.endsWith('/version') && method === 'POST') {
    result = await publishSopVersionHandler({ ...event, pathParameters: { id: sopMatch[1] } });
  } else if (pathname === '/sop/modules' && method === 'GET') {
    result = await listTrainingModulesHandler(event);
  // Module detail
  } else if (sopModuleProgressMatch && method === 'GET') {
    result = await getModuleProgressHandler({ ...event, pathParameters: { id: sopModuleProgressMatch[1], employeeId: sopModuleProgressMatch[2] } });
  } else if (sopModuleMatch && pathname.endsWith('/step-progress') && method === 'PUT') {
    result = await updateStepProgressHandler({ ...event, pathParameters: { id: sopModuleMatch[1] } });
  } else if (sopModuleMatch && pathname.endsWith('/quiz') && method === 'POST') {
    result = await submitQuizHandler({ ...event, pathParameters: { id: sopModuleMatch[1] } });
  } else if (sopModuleMatch && method === 'GET') {
    result = await getTrainingModuleHandler({ ...event, pathParameters: { id: sopModuleMatch[1] } });
  // Notes
  } else if (pathname === '/sop/notes' && method === 'GET') {
    result = await listNotesHandler(event);
  } else if (pathname === '/sop/notes' && method === 'POST') {
    result = await upsertNoteHandler(event);
  } else if (pathname.startsWith('/sop/notes/') && method === 'DELETE') {
    result = await deleteNoteHandler({ ...event, pathParameters: { id: pathname.split('/sop/notes/')[1] } });
  // Bookmarks
  } else if (pathname === '/sop/bookmarks' && method === 'GET') {
    result = await listBookmarksHandler(event);
  } else if (pathname === '/sop/bookmarks' && method === 'POST') {
    result = await toggleBookmarkHandler(event);
  // Q&A
  } else if (pathname === '/sop/questions' && method === 'GET') {
    result = await listQuestionsHandler(event);
  } else if (pathname === '/sop/questions' && method === 'POST') {
    result = await askQuestionHandler(event);
  } else if (sopQuestionAnswerMatch && method === 'POST') {
    result = await answerQuestionHandler({ ...event, pathParameters: { id: sopQuestionAnswerMatch[1] } });
  // Assignments
  } else if (pathname === '/sop/assignments' && method === 'GET') {
    result = await listMyAssignmentsHandler(event);
  } else if (sopMatch && pathname.endsWith('/complete') && method === 'POST') {
    result = await completeAssignmentHandler({ ...event, pathParameters: { assignmentId: sopMatch[1] } });
  // Inspection Templates (must come before generic sopMatch GET)
  } else if (sopItMatch && method === 'GET' && sopItMatch[1]) {
    result = await getInspectionTemplateHandler({ ...event, pathParameters: { id: sopItMatch[1] } });
  } else if (sopItMatch && method === 'GET') {
    result = await listInspectionTemplatesHandler(event);
  } else if (sopMatch && method === 'GET') {
    result = await getSopHandler({ ...event, pathParameters: { id: sopMatch[1] } });

  // ── Migration ─────────────────────────────────────────────────────────────
  } else if (pathname === '/migration/batches' && method === 'POST') {
    result = await triggerBatchHandler(event);
  } else if (pathname === '/migration/batches' && method === 'GET') {
    result = await listBatchesHandler(event);
  } else if (migrationBatchMatch && !pathname.endsWith('/cancel') && method === 'GET') {
    result = await getBatchHandler({ ...event, pathParameters: { id: migrationBatchMatch[1] } });
  } else if (migrationBatchMatch && pathname.endsWith('/cancel') && method === 'PATCH') {
    result = await cancelBatchHandler({ ...event, pathParameters: { id: migrationBatchMatch[1] } });

  // ── Accounting / QuickBooks ───────────────────────────────────────────────
  } else if ((pathname === '/accounting/oauth/connect' || pathname === '/accounting/quickbooks/connect') && method === 'GET') {
    result = await oauthConnectHandler(event);
  } else if ((pathname === '/accounting/oauth/callback' || pathname === '/accounting/quickbooks/callback') && method === 'GET') {
    result = await oauthCallbackHandler(event);
  } else if ((pathname === '/accounting/status' || pathname === '/accounting/quickbooks/status') && method === 'GET') {
    result = await qbStatusHandler(event);
  } else if ((pathname === '/accounting/invoice-sync' || pathname === '/accounting/invoices') && method === 'GET') {
    result = await listInvoiceSyncsHandler(event);
  } else if ((pathname === '/accounting/invoice-sync' || pathname === '/accounting/invoices') && method === 'POST') {
    result = await triggerInvoiceSyncHandler(event);
  } else if (qbInvoiceSyncMatch && pathname.endsWith('/retry') && method === 'POST') {
    result = await retryInvoiceSyncHandler({ ...event, pathParameters: { id: qbInvoiceSyncMatch[1] } });
  } else if (pathname === '/accounting/customers' && method === 'GET') {
    result = await listCustomerSyncsHandler(event);
  } else if (pathname === '/accounting/customers' && method === 'POST') {
    result = await triggerCustomerSyncHandler(event);
  } else if (pathname === '/accounting/reconciliation/runs' && method === 'GET') {
    result = await listReconciliationRunsHandler(event);
  } else if (pathname === '/accounting/reconciliation/runs' && method === 'POST') {
    result = await triggerReconciliationHandler(event);
  } else if (qbReconciliationRunMatch && method === 'GET') {
    result = await getReconciliationRunHandler({ ...event, pathParameters: { id: qbReconciliationRunMatch[1] } });
  } else if (pathname === '/accounting/reconciliation/mismatches' && method === 'GET') {
    result = await listMismatchesHandler(event);
  } else if (qbReconciliationRecordMatch && pathname.endsWith('/resolve') && method === 'POST') {
    result = await resolveReconciliationHandler({ ...event, pathParameters: { id: qbReconciliationRecordMatch[1] } });
  } else if (pathname === '/accounting/integration-accounts' && method === 'GET') {
    result = await listAccountsHandler(event);
  } else if (qbIntegrationAccountMatch && pathname.endsWith('/status') && method === 'PUT') {
    result = await updateAccountStatusHandler({ ...event, pathParameters: { id: qbIntegrationAccountMatch[1] } });
  } else if (pathname === '/accounting/failures/summary' && method === 'GET') {
    result = await getFailureSummaryHandler(event);
  } else if (pathname === '/accounting/failures/retry' && method === 'POST') {
    result = await retryFailedHandler(event);
  } else if (pathname === '/accounting/mappings/dimensions' && method === 'GET') {
    result = await listDimensionMappingsHandler(event);
  } else if (pathname === '/accounting/mappings/dimensions' && method === 'PUT') {
    result = await upsertDimensionMappingHandler(event);
  } else if (pathname === '/accounting/mappings/tax' && method === 'GET') {
    result = await listTaxMappingsHandler(event);
  } else if (pathname === '/accounting/mappings/tax' && method === 'PUT') {
    result = await upsertTaxMappingHandler(event);

  // ── Admin — User Management ───────────────────────────────────────────────
  } else if (pathname === '/admin/users' && method === 'GET') {
    result = await adminListUsersHandler(event);
  } else if (pathname === '/admin/users' && method === 'POST') {
    result = await adminCreateUserHandler(event);
  } else if (adminUserMatch && method === 'PATCH') {
    result = await adminUpdateUserHandler({ ...event, pathParameters: { username: adminUserMatch[1] } });
  } else if (adminUserMatch && method === 'DELETE') {
    result = await adminDeleteUserHandler({ ...event, pathParameters: { username: adminUserMatch[1] } });

  // ── Communication — Channels ──────────────────────────────────────────────
  } else if (pathname === '/communication/channels' && method === 'GET') {
    result = await listChannelsHandler(event);
  } else if (pathname === '/communication/channels' && method === 'POST') {
    result = await createChannelHandler(event);

  // ── Communication — Messages ──────────────────────────────────────────────
  } else if (channelMessagesMatch && method === 'GET') {
    result = await listMessagesHandler({ ...event, pathParameters: { channelId: channelMessagesMatch[1] } });
  } else if (channelMessagesMatch && method === 'POST') {
    result = await sendMessageHandler({ ...event, pathParameters: { channelId: channelMessagesMatch[1] } });
  } else if (commMessageRepliesMatch && method === 'GET') {
    result = await listRepliesHandler({ ...event, pathParameters: { messageId: commMessageRepliesMatch[1] } });
  } else if (commMessageReactionsMatch && method === 'POST') {
    result = await addReactionHandler({ ...event, pathParameters: { messageId: commMessageReactionsMatch[1] } });
  } else if (commMessageReactionsMatch && commMessageReactionsMatch[2] && method === 'DELETE') {
    result = await removeReactionHandler({ ...event, pathParameters: { messageId: commMessageReactionsMatch[1], emoji: commMessageReactionsMatch[2] } });
  } else if (commMessageMatch && method === 'PATCH') {
    result = await editMessageHandler({ ...event, pathParameters: { messageId: commMessageMatch[1] } });
  } else if (commMessageMatch && method === 'DELETE') {
    result = await deleteMessageHandler({ ...event, pathParameters: { messageId: commMessageMatch[1] } });

  // ── Communication — Todos ─────────────────────────────────────────────────
  } else if (channelTodosMatch && method === 'GET') {
    result = await listTodosHandler({ ...event, pathParameters: { channelId: channelTodosMatch[1] } });
  } else if (channelTodosMatch && method === 'POST') {
    result = await createTodoHandler({ ...event, pathParameters: { channelId: channelTodosMatch[1] } });
  } else if (commTodoMatch && method === 'PATCH') {
    result = await updateTodoHandler({ ...event, pathParameters: { todoId: commTodoMatch[1] } });

  // ── Communication — Notifications ─────────────────────────────────────────
  } else if (pathname === '/communication/notifications' && method === 'GET') {
    result = await listNotificationsHandler(event);
  } else if (pathname === '/communication/notifications/read' && method === 'PATCH') {
    result = await markNotificationsReadHandler(event);

  // ── Sales — Opportunities ─────────────────────────────────────────────────
  } else if (pathname === '/sales/opportunities' && method === 'GET') {
    result = await listOpportunitiesHandler(event);
  } else if (pathname === '/sales/opportunities' && method === 'POST') {
    result = await createOpportunityHandler(event);
  } else if (salesOpportunityMatch && pathname.endsWith('/stage') && method === 'POST') {
    result = await transitionOpportunityStageHandler({ ...event, pathParameters: { id: salesOpportunityMatch[1] } });
  } else if (salesOpportunityMatch && method === 'GET') {
    result = await getOpportunityHandler({ ...event, pathParameters: { id: salesOpportunityMatch[1] } });
  } else if (salesOpportunityMatch && method === 'PATCH') {
    result = await updateOpportunityHandler({ ...event, pathParameters: { id: salesOpportunityMatch[1] } });

  // ── Sales — Quotes ────────────────────────────────────────────────────────
  } else if (pathname === '/sales/quotes' && method === 'GET') {
    result = await listQuotesHandler(event);
  } else if (pathname === '/sales/quotes' && method === 'POST') {
    result = await createQuoteHandler(event);
  } else if (salesQuoteMatch && pathname.endsWith('/lines') && method === 'PATCH') {
    result = await updateQuoteLinesHandler({ ...event, pathParameters: { id: salesQuoteMatch[1] } });
  } else if (salesQuoteMatch && pathname.endsWith('/send') && method === 'POST') {
    result = await sendQuoteHandler({ ...event, pathParameters: { id: salesQuoteMatch[1] } });
  } else if (salesQuoteMatch && pathname.endsWith('/accept') && method === 'POST') {
    result = await acceptQuoteHandler({ ...event, pathParameters: { id: salesQuoteMatch[1] } });
  } else if (salesQuoteMatch && pathname.endsWith('/reject') && method === 'POST') {
    result = await rejectQuoteHandler({ ...event, pathParameters: { id: salesQuoteMatch[1] } });
  } else if (salesQuoteMatch && method === 'GET') {
    result = await getQuoteHandler({ ...event, pathParameters: { id: salesQuoteMatch[1] } });
  } else if (salesQuoteMatch && method === 'PUT') {
    result = await updateQuoteHandler({ ...event, pathParameters: { id: salesQuoteMatch[1] } });

  // ── Sales — Activities & Stats ────────────────────────────────────────────
  } else if (pathname === '/sales/activities' && method === 'GET') {
    result = await listActivitiesHandler(event);
  } else if (pathname === '/sales/activities' && method === 'POST') {
    result = await createActivityHandler(event);
  } else if (pathname === '/sales/pipeline-stats' && method === 'GET') {
    result = await getPipelineStatsHandler(event);
  } else if (pathname === '/sales/forecast' && method === 'GET') {
    result = await getSalesForecastHandler(event);
  } else if (pathname === '/sales/dashboard' && method === 'GET') {
    result = await getSalesDashboardHandler(event);

  // ── Sales — AI Agent ──────────────────────────────────────────────────────
  } else if (pathname === '/sales/agent/chat' && method === 'POST') {
    result = await salesAgentChatHandler(event);
  } else if (pathname === '/sales/agent/sessions' && method === 'GET') {
    result = await salesAgentSessionsHandler(event);
  } else if (salesAgentSessionMatch && method === 'GET') {
    result = await salesAgentSessionDetailHandler({ ...event, pathParameters: { sessionId: salesAgentSessionMatch[1] } });

  // ── Global ERP Copilot ────────────────────────────────────────────────────
  } else if (pathname === '/copilot/chat' && method === 'POST') {
    result = await copilotChatHandler(event);
  } else if (pathname === '/copilot/sessions' && method === 'GET') {
    result = await copilotSessionsHandler(event);
  } else if (copilotSessionMatch && method === 'GET') {
    result = await copilotSessionDetailHandler({ ...event, pathParameters: { sessionId: copilotSessionMatch[1] } });

  // ── Audit ─────────────────────────────────────────────────────────────────
  } else if (pathname === '/audit/events' && method === 'GET') {
    result = await listAuditEventsHandler(event);

  // ── Scheduling ────────────────────────────────────────────────────────────
  } else if (pathname === '/scheduling/slots' && method === 'GET') {
    result = await listBuildSlotsHandler(event);
  } else if (pathname === '/scheduling/labor-capacity' && method === 'GET') {
    result = await listLaborCapacityHandler(event);

  // ── OJT / Training Assignments (aliases for /sop) ─────────────────────────
  } else if (pathname === '/ojt/assignments' && method === 'GET') {
    result = await listMyAssignmentsHandler(event);
  } else if (ojtAssignmentMatch && method === 'POST') {
    result = await completeAssignmentHandler({ ...event, pathParameters: { assignmentId: ojtAssignmentMatch[1] } });
  } else if (ojtAssignmentMatch && method === 'PATCH') {
    result = await completeAssignmentHandler({ ...event, pathParameters: { assignmentId: ojtAssignmentMatch[1] } });

  } else {
    res.writeHead(404, { ...CORS_HEADERS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `No route: ${method} ${pathname}` }));
    return;
  }

  res.writeHead(result.statusCode, { ...CORS_HEADERS, ...result.headers });
  res.end(result.body);
}

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    console.error('Unhandled error:', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 GG ERP API (local dev) running at http://localhost:${PORT}`);
  console.log(`   Auth        GET /auth/me`);
  console.log(`   Workspace   GET /workspace/today`);
  console.log(`   Customers   GET|POST /identity/customers, GET|POST /:id/transition`);
  console.log(`   Inventory   GET|POST /inventory/parts, GET /inventory/vendors`);
  console.log(`   Tickets     /tickets/work-orders/:id/tasks|rework|qc-gates|time-entries`);
  console.log(`   Queue       GET /tickets/wo-queue, GET /tickets/wo-queue/:id`);
  console.log(`   Time        GET /tickets/time-entries`);
  console.log(`   Routing     GET|PATCH /tickets/routing-steps/:id`);
  console.log(`   Planning    GET|POST /planning/work-orders`);
  console.log(`   SOP         GET|POST /sop, /sop/modules, /sop/modules/:id`);
  console.log(`   Training    PUT /sop/modules/:id/step-progress, POST /sop/modules/:id/quiz`);
  console.log(`   Migration   GET|POST /migration/batches, /:id, /:id/cancel`);
  console.log(`   QB OAuth    GET /accounting/oauth/connect|callback, GET /accounting/status`);
  console.log(`   Invoices    GET|POST /accounting/invoice-sync, POST /:id/retry`);
  console.log(`   Customers   GET|POST /accounting/customers`);
  console.log(`   Reconcile   GET|POST /accounting/reconciliation/runs, GET /:id, GET /mismatches`);
  console.log(`   Accounts    GET /accounting/integration-accounts, PUT /:id/status`);
  console.log(`   Failures    GET /accounting/failures/summary, POST /accounting/failures/retry\n`);
});
