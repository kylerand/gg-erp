#!/usr/bin/env tsx
/**
 * Lambda build pipeline using esbuild.
 * Bundles each Lambda handler to dist/lambdas/{context}/{handler}.js
 * All handlers in a context share one output directory, which is then zipped
 * into apps/api/dist/{context}-lambda.zip by package-lambdas.ts.
 *
 * Usage:
 *   npm run build:lambdas
 */

import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

interface LambdaEntry {
  context: string; // output subdir and zip name, e.g. 'work-orders'
  handler: string; // output filename stem matching Terraform handler attr, e.g. 'create'
  entry: string;   // source path relative to repo root
}

const lambdas: LambdaEntry[] = [
  // identity
  { context: 'identity', handler: 'me',             entry: 'apps/api/src/lambda/identity/me.handler.ts' },
  { context: 'identity', handler: 'admin-list-users',   entry: 'apps/api/src/lambda/identity/admin-list-users.entry.ts' },
  { context: 'identity', handler: 'admin-create-user',  entry: 'apps/api/src/lambda/identity/admin-create-user.entry.ts' },
  { context: 'identity', handler: 'admin-update-user',  entry: 'apps/api/src/lambda/identity/admin-update-user.entry.ts' },
  { context: 'identity', handler: 'admin-delete-user',  entry: 'apps/api/src/lambda/identity/admin-delete-user.entry.ts' },

  // work-orders
  { context: 'work-orders', handler: 'create',     entry: 'apps/api/src/lambda/work-orders/create.handler.ts' },
  { context: 'work-orders', handler: 'list',        entry: 'apps/api/src/lambda/work-orders/list.handler.ts' },
  { context: 'work-orders', handler: 'transition',  entry: 'apps/api/src/lambda/work-orders/transition.handler.ts' },

  // customers
  { context: 'customers', handler: 'create',      entry: 'apps/api/src/lambda/customers/create.handler.ts' },
  { context: 'customers', handler: 'get',          entry: 'apps/api/src/lambda/customers/get.handler.ts' },
  { context: 'customers', handler: 'list',          entry: 'apps/api/src/lambda/customers/list.handler.ts' },
  { context: 'customers', handler: 'transition',    entry: 'apps/api/src/lambda/customers/transition.handler.ts' },

  // inventory
  { context: 'inventory', handler: 'create-part',  entry: 'apps/api/src/lambda/inventory/create-part.handler.ts' },
  { context: 'inventory', handler: 'get-part',      entry: 'apps/api/src/lambda/inventory/get-part.handler.ts' },
  { context: 'inventory', handler: 'list-lots',     entry: 'apps/api/src/lambda/inventory/list-lots.handler.ts' },
  { context: 'inventory', handler: 'list-parts',    entry: 'apps/api/src/lambda/inventory/list-parts.handler.ts' },
  { context: 'inventory', handler: 'list-vendors',          entry: 'apps/api/src/lambda/inventory/list-vendors.handler.ts' },
  { context: 'inventory', handler: 'list-purchase-orders', entry: 'apps/api/src/lambda/inventory/list-purchase-orders.handler.ts' },

  // tickets
  { context: 'tickets', handler: 'create-rework',    entry: 'apps/api/src/lambda/tickets/create-rework.handler.ts' },
  { context: 'tickets', handler: 'create-task',      entry: 'apps/api/src/lambda/tickets/create-task.handler.ts' },
  { context: 'tickets', handler: 'list-rework',      entry: 'apps/api/src/lambda/tickets/list-rework.handler.ts' },
  { context: 'tickets', handler: 'list-sync',        entry: 'apps/api/src/lambda/tickets/list-sync.handler.ts' },
  { context: 'tickets', handler: 'list-tasks',        entry: 'apps/api/src/lambda/tickets/list-tasks.handler.ts' },
  { context: 'tickets', handler: 'transition-task',    entry: 'apps/api/src/lambda/tickets/transition-task.handler.ts' },
  { context: 'tickets', handler: 'list-time-entries',  entry: 'apps/api/src/lambda/tickets/list-time-entries.handler.ts' },
  { context: 'tickets', handler: 'create-time-entry',  entry: 'apps/api/src/lambda/tickets/create-time-entry.handler.ts' },
  { context: 'tickets', handler: 'update-time-entry',  entry: 'apps/api/src/lambda/tickets/update-time-entry.handler.ts' },
  { context: 'tickets', handler: 'delete-time-entry',  entry: 'apps/api/src/lambda/tickets/delete-time-entry.handler.ts' },
  { context: 'tickets', handler: 'list-wo-queue',      entry: 'apps/api/src/lambda/tickets/list-wo-queue.handler.ts' },
  { context: 'tickets', handler: 'get-wo-detail',      entry: 'apps/api/src/lambda/tickets/get-wo-detail.handler.ts' },
  { context: 'tickets', handler: 'list-all-time-entries', entry: 'apps/api/src/lambda/tickets/list-all-time-entries.handler.ts' },

  // attachments
  { context: 'attachments', handler: 'confirm-upload',    entry: 'apps/api/src/lambda/attachments/confirm-upload.handler.ts' },
  { context: 'attachments', handler: 'list',              entry: 'apps/api/src/lambda/attachments/list.handler.ts' },
  { context: 'attachments', handler: 'presign-download',  entry: 'apps/api/src/lambda/attachments/presign-download.handler.ts' },
  { context: 'attachments', handler: 'presign-upload',    entry: 'apps/api/src/lambda/attachments/presign-upload.handler.ts' },

  // sop
  { context: 'sop', handler: 'complete-assignment',  entry: 'apps/api/src/lambda/sop/complete-assignment.handler.ts' },
  { context: 'sop', handler: 'create',                entry: 'apps/api/src/lambda/sop/create.handler.ts' },
  { context: 'sop', handler: 'get',                    entry: 'apps/api/src/lambda/sop/get.handler.ts' },
  { context: 'sop', handler: 'list',                  entry: 'apps/api/src/lambda/sop/list.handler.ts' },
  { context: 'sop', handler: 'list-assignments',      entry: 'apps/api/src/lambda/sop/list-assignments.handler.ts' },
  { context: 'sop', handler: 'list-modules',          entry: 'apps/api/src/lambda/sop/list-modules.handler.ts' },
  { context: 'sop', handler: 'publish-version',          entry: 'apps/api/src/lambda/sop/publish-version.handler.ts' },
  { context: 'sop', handler: 'get-module',               entry: 'apps/api/src/lambda/sop/get-module.handler.ts' },
  { context: 'sop', handler: 'get-module-progress',      entry: 'apps/api/src/lambda/sop/get-module-progress.handler.ts' },
  { context: 'sop', handler: 'update-step-progress',     entry: 'apps/api/src/lambda/sop/update-step-progress.handler.ts' },
  { context: 'sop', handler: 'submit-quiz',              entry: 'apps/api/src/lambda/sop/submit-quiz.handler.ts' },
  { context: 'sop', handler: 'list-notes',               entry: 'apps/api/src/lambda/sop/list-notes.handler.ts' },
  { context: 'sop', handler: 'upsert-note',              entry: 'apps/api/src/lambda/sop/upsert-note.handler.ts' },
  { context: 'sop', handler: 'delete-note',              entry: 'apps/api/src/lambda/sop/delete-note.handler.ts' },
  { context: 'sop', handler: 'list-bookmarks',           entry: 'apps/api/src/lambda/sop/list-bookmarks.handler.ts' },
  { context: 'sop', handler: 'toggle-bookmark',          entry: 'apps/api/src/lambda/sop/toggle-bookmark.handler.ts' },
  { context: 'sop', handler: 'list-questions',           entry: 'apps/api/src/lambda/sop/list-questions.handler.ts' },
  { context: 'sop', handler: 'ask-question',             entry: 'apps/api/src/lambda/sop/ask-question.handler.ts' },
  { context: 'sop', handler: 'answer-question',          entry: 'apps/api/src/lambda/sop/answer-question.handler.ts' },
  { context: 'sop', handler: 'list-inspection-templates', entry: 'apps/api/src/lambda/sop/list-inspection-templates.handler.ts' },
  { context: 'sop', handler: 'get-inspection-template',  entry: 'apps/api/src/lambda/sop/get-inspection-template.handler.ts' },

  // accounting
  { context: 'accounting', handler: 'list-sync',        entry: 'apps/api/src/lambda/accounting/list-sync.handler.ts' },
  { context: 'accounting', handler: 'oauth-callback',    entry: 'apps/api/src/lambda/accounting/oauth-callback.handler.ts' },
  { context: 'accounting', handler: 'oauth-connect',    entry: 'apps/api/src/lambda/accounting/oauth-connect.handler.ts' },
  { context: 'accounting', handler: 'retry-sync',        entry: 'apps/api/src/lambda/accounting/retry-sync.handler.ts' },
  { context: 'accounting', handler: 'status',            entry: 'apps/api/src/lambda/accounting/status.handler.ts' },
  { context: 'accounting', handler: 'trigger-sync',      entry: 'apps/api/src/lambda/accounting/trigger-sync.handler.ts' },
  { context: 'accounting', handler: 'webhook',            entry: 'apps/api/src/lambda/accounting/webhook.handler.ts' },
  { context: 'accounting', handler: 'list-accounts',       entry: 'apps/api/src/lambda/accounting/list-accounts.handler.ts' },
  { context: 'accounting', handler: 'update-account-status', entry: 'apps/api/src/lambda/accounting/update-account-status.handler.ts' },
  { context: 'accounting', handler: 'list-invoice-syncs',     entry: 'apps/api/src/lambda/accounting/list-invoice-syncs.handler.ts' },
  { context: 'accounting', handler: 'trigger-invoice-sync',   entry: 'apps/api/src/lambda/accounting/trigger-invoice-sync.handler.ts' },
  { context: 'accounting', handler: 'retry-invoice-sync',     entry: 'apps/api/src/lambda/accounting/retry-invoice-sync.handler.ts' },
  { context: 'accounting', handler: 'list-customer-syncs',    entry: 'apps/api/src/lambda/accounting/list-customer-syncs.handler.ts' },
  { context: 'accounting', handler: 'trigger-customer-sync',  entry: 'apps/api/src/lambda/accounting/trigger-customer-sync.handler.ts' },
  { context: 'accounting', handler: 'list-reconciliation-runs',  entry: 'apps/api/src/lambda/accounting/list-reconciliation-runs.handler.ts' },
  { context: 'accounting', handler: 'trigger-reconciliation',    entry: 'apps/api/src/lambda/accounting/trigger-reconciliation.handler.ts' },
  { context: 'accounting', handler: 'get-reconciliation-run',    entry: 'apps/api/src/lambda/accounting/get-reconciliation-run.handler.ts' },
  { context: 'accounting', handler: 'list-mismatches',           entry: 'apps/api/src/lambda/accounting/list-mismatches.handler.ts' },
  { context: 'accounting', handler: 'resolve-reconciliation',    entry: 'apps/api/src/lambda/accounting/resolve-reconciliation.handler.ts' },
  { context: 'accounting', handler: 'get-failure-summary',       entry: 'apps/api/src/lambda/accounting/get-failure-summary.handler.ts' },
  { context: 'accounting', handler: 'retry-failed',              entry: 'apps/api/src/lambda/accounting/retry-failed.handler.ts' },

  // workers
  { context: 'workers', handler: 'payment-sync',      entry: 'apps/workers/src/payment-sync.handler.ts' },
  { context: 'workers', handler: 'reconciliation',    entry: 'apps/workers/src/reconciliation.handler.ts' },

  // migration
  { context: 'migration', handler: 'cancel-batch',    entry: 'apps/api/src/lambda/migration/cancel-batch.handler.ts' },
  { context: 'migration', handler: 'get-batch',        entry: 'apps/api/src/lambda/migration/get-batch.handler.ts' },
  { context: 'migration', handler: 'list-batches',    entry: 'apps/api/src/lambda/migration/list-batches.handler.ts' },
  { context: 'migration', handler: 'trigger-batch',    entry: 'apps/api/src/lambda/migration/trigger-batch.handler.ts' },
  { context: 'migration', handler: 'run-migration',    entry: 'apps/api/src/lambda/migration/run-migration.entry.ts' },
  { context: 'migration', handler: 'migrate-parts',    entry: 'apps/api/src/lambda/migration/migrate-parts.entry.ts' },

  // communication (messaging, channels, todos, notifications)
  { context: 'communication', handler: 'list-channels',           entry: 'apps/api/src/lambda/communication/list-channels.handler.ts' },
  { context: 'communication', handler: 'create-channel',          entry: 'apps/api/src/lambda/communication/create-channel.handler.ts' },
  { context: 'communication', handler: 'list-messages',           entry: 'apps/api/src/lambda/communication/list-messages.handler.ts' },
  { context: 'communication', handler: 'list-replies',            entry: 'apps/api/src/lambda/communication/list-replies.handler.ts' },
  { context: 'communication', handler: 'send-message',            entry: 'apps/api/src/lambda/communication/send-message.handler.ts' },
  { context: 'communication', handler: 'edit-message',            entry: 'apps/api/src/lambda/communication/edit-message.handler.ts' },
  { context: 'communication', handler: 'delete-message',          entry: 'apps/api/src/lambda/communication/delete-message.handler.ts' },
  { context: 'communication', handler: 'add-reaction',            entry: 'apps/api/src/lambda/communication/add-reaction.handler.ts' },
  { context: 'communication', handler: 'remove-reaction',         entry: 'apps/api/src/lambda/communication/remove-reaction.handler.ts' },
  { context: 'communication', handler: 'list-todos',              entry: 'apps/api/src/lambda/communication/list-todos.handler.ts' },
  { context: 'communication', handler: 'create-todo',             entry: 'apps/api/src/lambda/communication/create-todo.handler.ts' },
  { context: 'communication', handler: 'update-todo',             entry: 'apps/api/src/lambda/communication/update-todo.handler.ts' },
  { context: 'communication', handler: 'list-notifications',      entry: 'apps/api/src/lambda/communication/list-notifications.handler.ts' },
  { context: 'communication', handler: 'mark-notifications-read', entry: 'apps/api/src/lambda/communication/mark-notifications-read.handler.ts' },

  // scheduling (planner board)
  { context: 'scheduling', handler: 'list-slots',            entry: 'apps/api/src/lambda/scheduling/list-slots.handler.ts' },
  { context: 'scheduling', handler: 'list-labor-capacity',   entry: 'apps/api/src/lambda/scheduling/list-labor-capacity.handler.ts' },

  // audit
  { context: 'audit', handler: 'list-audit-events', entry: 'apps/api/src/lambda/audit/list-audit-events.handler.ts' },

  // sales
  { context: 'sales', handler: 'list-opportunities',     entry: 'apps/api/src/lambda/sales/list-opportunities.handler.ts' },
  { context: 'sales', handler: 'get-opportunity',         entry: 'apps/api/src/lambda/sales/get-opportunity.handler.ts' },
  { context: 'sales', handler: 'create-opportunity',      entry: 'apps/api/src/lambda/sales/create-opportunity.handler.ts' },
  { context: 'sales', handler: 'update-opportunity',      entry: 'apps/api/src/lambda/sales/update-opportunity.handler.ts' },
  { context: 'sales', handler: 'transition-opportunity',  entry: 'apps/api/src/lambda/sales/transition-opportunity.handler.ts' },
  { context: 'sales', handler: 'list-quotes',             entry: 'apps/api/src/lambda/sales/list-quotes.handler.ts' },
  { context: 'sales', handler: 'get-quote',               entry: 'apps/api/src/lambda/sales/get-quote.handler.ts' },
  { context: 'sales', handler: 'create-quote',            entry: 'apps/api/src/lambda/sales/create-quote.handler.ts' },
  { context: 'sales', handler: 'update-quote',            entry: 'apps/api/src/lambda/sales/update-quote.handler.ts' },
  { context: 'sales', handler: 'update-quote-lines',      entry: 'apps/api/src/lambda/sales/update-quote-lines.handler.ts' },
  { context: 'sales', handler: 'send-quote',              entry: 'apps/api/src/lambda/sales/send-quote.handler.ts' },
  { context: 'sales', handler: 'accept-quote',            entry: 'apps/api/src/lambda/sales/accept-quote.handler.ts' },
  { context: 'sales', handler: 'reject-quote',            entry: 'apps/api/src/lambda/sales/reject-quote.handler.ts' },
  { context: 'sales', handler: 'list-activities',         entry: 'apps/api/src/lambda/sales/list-activities.handler.ts' },
  { context: 'sales', handler: 'create-activity',         entry: 'apps/api/src/lambda/sales/create-activity.handler.ts' },
  { context: 'sales', handler: 'pipeline-stats',          entry: 'apps/api/src/lambda/sales/pipeline-stats.handler.ts' },
  { context: 'sales', handler: 'forecast',                entry: 'apps/api/src/lambda/sales/forecast.handler.ts' },
  { context: 'sales', handler: 'dashboard',               entry: 'apps/api/src/lambda/sales/dashboard.handler.ts' },
];

// Tracks which context dirs have already had the Prisma engine copied.
const prismaEngineCopied = new Set<string>();

function copyPrismaEngine(outDir: string): void {
  if (prismaEngineCopied.has(outDir)) return;

  const enginePattern = /libquery_engine.*\.so\.node/;
  const searchPaths = [
    join(root, 'node_modules/.prisma/client'),
    join(root, 'node_modules/@prisma/client'),
    join(root, 'packages/db/node_modules/.prisma/client'),
  ];

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue;
    const files = readdirSync(searchPath).filter(f => enginePattern.test(f));
    for (const file of files) {
      copyFileSync(join(searchPath, file), join(outDir, file));
      console.log(`  ↳ Copied Prisma engine to ${outDir.split('/').slice(-1)[0]}/: ${file}`);
      prismaEngineCopied.add(outDir);
      return;
    }
  }
  // Not found is OK during local dev (native binary used instead)
  console.log('  ↳ Prisma engine binary not found (OK for local dev, required for Lambda deploy)');
  prismaEngineCopied.add(outDir);
}

async function buildLambda(lambda: LambdaEntry): Promise<void> {
  const outDir = join(root, 'dist', 'lambdas', lambda.context);
  mkdirSync(outDir, { recursive: true });

  const outfile = join(outDir, `${lambda.handler}.js`);

  await build({
    entryPoints: [join(root, lambda.entry)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    // aws-sdk v3 is available in Lambda runtime; prisma client must be bundled
    external: ['@aws-sdk/*'],
    minify: false,
    sourcemap: true,
    metafile: true,
    logLevel: 'info',
  });

  console.log(`✓ Built ${lambda.context}/${lambda.handler} → dist/lambdas/${lambda.context}/${lambda.handler}.js`);
  copyPrismaEngine(outDir);
}

async function main(): Promise<void> {
  console.log(`Building ${lambdas.length} Lambda handlers across ${new Set(lambdas.map(l => l.context)).size} contexts...\n`);

  try {
    await Promise.all(lambdas.map(buildLambda));
    console.log('\n✅ All Lambda handlers built successfully');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

main();
