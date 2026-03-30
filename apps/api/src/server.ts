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
  createPartHandler,
  listVendorsHandler,
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
import { getMeHandler } from './lambda/identity/handlers.js';

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
  const partMatch = pathname.match(/^\/inventory\/parts\/([^/]+)/);
  const taskMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/tasks(?:\/([^/]+))?/);
  const reworkMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/rework/);
  const qcMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/qc-gates/);
  const timeEntryMatch = pathname.match(/^\/tickets\/work-orders\/([^/]+)\/time-entries(?:\/([^/]+))?/);
  const sopMatch = pathname.match(/^\/sop\/([^/]+)/);
  const sopModuleMatch = pathname.match(/^\/sop\/modules\/([^/]+)/);
  const sopModuleProgressMatch = pathname.match(/^\/sop\/modules\/([^/]+)\/progress\/([^/]+)/);
  const sopQuestionAnswerMatch = pathname.match(/^\/sop\/questions\/([^/]+)\/answer/);
  const sopItMatch = pathname.match(/^\/sop\/inspection-templates(?:\/([^/]+))?$/);
  const routingStepMatch = pathname.match(/^\/tickets\/routing-steps\/([^/]+)/);
  const woQueueMatch = pathname.match(/^\/tickets\/wo-queue\/([^/]+)/);

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (pathname === '/auth/me' && method === 'GET') {
    result = await getMeHandler(event);

  // ── Planning ──────────────────────────────────────────────────────────────
  } else if (pathname === '/planning/work-orders' && method === 'POST') {
    result = await createWorkOrderHandler(event);
  } else if (pathname === '/planning/work-orders' && method === 'GET') {
    result = await listWorkOrdersHandler(event);

  // ── Customers ─────────────────────────────────────────────────────────────
  } else if (pathname === '/identity/customers' && method === 'GET') {
    result = await listCustomersHandler(event);
  } else if (pathname === '/identity/customers' && method === 'POST') {
    result = await createCustomerHandler(event);
  } else if (customerMatch && method === 'GET') {
    result = await getCustomerHandler({ ...event, pathParameters: { id: customerMatch[1] } });
  } else if (customerMatch && pathname.endsWith('/transition') && method === 'POST') {
    result = await transitionCustomerStateHandler({ ...event, pathParameters: { id: customerMatch[1] } });

  // ── Inventory ─────────────────────────────────────────────────────────────
  } else if (pathname === '/inventory/parts' && method === 'GET') {
    result = await listPartsHandler(event);
  } else if (pathname === '/inventory/lots' && method === 'GET') {
    result = await listLotsHandler(event);
  } else if (pathname === '/inventory/parts' && method === 'POST') {
    result = await createPartHandler(event);
  } else if (partMatch && method === 'GET') {
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

  } else if (routingStepMatch && method === 'GET') {
    result = await listRoutingStepsHandler({ ...event, pathParameters: { workOrderId: routingStepMatch[1] } });
  } else if (routingStepMatch && method === 'PATCH') {
    result = await transitionRoutingStepStateHandler({ ...event, pathParameters: { stepId: routingStepMatch[1] } });

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
  console.log(`   Customers   GET|POST /identity/customers, GET|POST /:id/transition`);
  console.log(`   Inventory   GET|POST /inventory/parts, GET /inventory/vendors`);
  console.log(`   Tickets     /tickets/work-orders/:id/tasks|rework|qc-gates|time-entries`);
  console.log(`   Queue       GET /tickets/wo-queue, GET /tickets/wo-queue/:id`);
  console.log(`   Time        GET /tickets/time-entries`);
  console.log(`   Routing     GET|PATCH /tickets/routing-steps/:id`);
  console.log(`   Planning    GET|POST /planning/work-orders`);
  console.log(`   SOP         GET|POST /sop, /sop/modules, /sop/modules/:id`);
  console.log(`   Training    PUT /sop/modules/:id/step-progress, POST /sop/modules/:id/quiz`);
  console.log(`   Migration   GET|POST /migration/batches, /:id, /:id/cancel\n`);
});
