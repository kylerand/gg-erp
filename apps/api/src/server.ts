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

async function route(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0];
  const body = await readBody(req);

  const event: ApiGatewayProxyEventLike = {
    body: body || null,
    headers: toLambdaHeaders(req),
    queryStringParameters: parseQueryString(rawUrl),
    requestContext: { requestId: `local-${Date.now()}` },
  };

  let result: Awaited<ReturnType<typeof createWorkOrderHandler>> | null = null;

  if (pathname === '/planning/work-orders' && method === 'POST') {
    result = await createWorkOrderHandler(event);
  } else if (pathname === '/planning/work-orders' && method === 'GET') {
    result = await listWorkOrdersHandler(event);
  } else {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `No route: ${method} ${pathname}` }));
    return;
  }

  res.writeHead(result.statusCode, result.headers);
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
  console.log(`   POST /planning/work-orders  — create work order`);
  console.log(`   GET  /planning/work-orders  — list work orders\n`);
});
