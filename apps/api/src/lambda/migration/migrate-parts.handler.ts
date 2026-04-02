/**
 * Lambda handler: fetch inventory parts + order service line items from ShopMonkey API,
 * enrich the existing export JSON (in S3), and run Wave C (parts) + Wave G (work orders).
 *
 * Invoked directly (not via API Gateway) with a 15-min timeout.
 *
 * Event payload:
 *   {
 *     smEmail: string;
 *     smPassword: string;
 *     s3Bucket: string;
 *     s3Key: string;           // existing shopmonkey export JSON
 *     dryRun?: boolean;
 *     skipServiceFetch?: boolean;  // skip per-order service fetch (slow for 462 orders)
 *     onlyWaves?: string[];       // e.g. ["C"] to only run parts, default: ["C","F","G"]
 *   }
 */
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import {
  login,
  fetchInventoryParts,
  fetchOrderServices,
  fetchVendors,
  fetchPurchaseOrders,
  type ShopMonkeyExport,
  type SmInventoryPart,
  type SmService,
} from '@gg-erp/migration/connectors/shopmonkey-api.connector.js';
import { runWaveC } from '@gg-erp/migration/loaders/wave-c.loader.js';
import { runWaveF } from '@gg-erp/migration/loaders/wave-f.loader.js';
import { runWaveG } from '@gg-erp/migration/loaders/wave-g.loader.js';

interface MigratePartsEvent {
  smEmail: string;
  smPassword: string;
  s3Bucket: string;
  s3Key: string;
  dryRun?: boolean;
  skipServiceFetch?: boolean;
  onlyWaves?: string[];
}

interface WaveReport {
  wave: string;
  label: string;
  inserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
  status: 'ok' | 'error';
  error?: string;
}

const s3 = new S3Client({});
const TMP_EXPORT = '/tmp/shopmonkey-export-enriched.json';

async function downloadExport(bucket: string, key: string): Promise<ShopMonkeyExport> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await s3.send(cmd);
  const body = await resp.Body?.transformToString('utf-8');
  if (!body) throw new Error(`Empty S3 object: s3://${bucket}/${key}`);
  return JSON.parse(body);
}

async function uploadEnrichedExport(
  bucket: string,
  key: string,
  data: ShopMonkeyExport,
): Promise<string> {
  const enrichedKey = key.replace(/\.json$/, '-with-parts.json');
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: enrichedKey,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    }),
  );
  return enrichedKey;
}

export async function handle(event: MigratePartsEvent) {
  const {
    smEmail,
    smPassword,
    s3Bucket,
    s3Key,
    dryRun = false,
    skipServiceFetch = false,
    onlyWaves,
  } = event;

  const wavesToRun = new Set(
    (onlyWaves ?? ['C', 'F', 'G']).map((w) => w.toUpperCase()),
  );

  console.log(
    `[migrate-parts] Starting. s3://${s3Bucket}/${s3Key} dryRun=${dryRun} waves=${[...wavesToRun].join(',')}`,
  );

  // ── Step 1: Download existing export ─────────────────────────────────────
  console.log('[migrate-parts] Downloading existing export from S3...');
  const exportData = await downloadExport(s3Bucket, s3Key);
  console.log(
    `[migrate-parts] Export has ${exportData.orders.length} orders, ${(exportData.inventoryParts ?? []).length} parts`,
  );

  // ── Step 2: Login to ShopMonkey API ──────────────────────────────────────
  console.log(`[migrate-parts] Logging into ShopMonkey as ${smEmail}...`);
  const session = await login(smEmail, smPassword);
  console.log(`[migrate-parts] Authenticated. companyId=${session.companyId}`);

  // ── Step 3: Fetch inventory parts ────────────────────────────────────────
  console.log('[migrate-parts] Fetching inventory parts catalog...');
  const inventoryParts: SmInventoryPart[] = await fetchInventoryParts(session);
  console.log(`[migrate-parts] Fetched ${inventoryParts.length} inventory parts`);
  exportData.inventoryParts = inventoryParts;
  exportData.counts.inventoryParts = inventoryParts.length;

  // ── Step 4: Fetch vendors + purchase orders (for Wave F) ─────────────────
  if (wavesToRun.has('F')) {
    if (!exportData.purchaseOrders || exportData.purchaseOrders.length === 0) {
      console.log('[migrate-parts] Fetching purchase orders...');
      exportData.purchaseOrders = await fetchPurchaseOrders(session);
      console.log(`[migrate-parts]   → ${exportData.purchaseOrders.length} purchase orders`);
    }
    if (!exportData.vendors || exportData.vendors.length === 0) {
      console.log('[migrate-parts] Fetching vendors...');
      exportData.vendors = await fetchVendors(session);
      console.log(`[migrate-parts]   → ${exportData.vendors.length} vendors`);
    }
  }

  // ── Step 5: Fetch service line items per order (for Wave G) ──────────────
  if (!skipServiceFetch && wavesToRun.has('G')) {
    console.log(
      `[migrate-parts] Fetching service line items for ${exportData.orders.length} orders...`,
    );
    let enriched = 0;
    let failed = 0;

    for (let i = 0; i < exportData.orders.length; i++) {
      const order = exportData.orders[i];
      if (order.services && order.services.length > 0) {
        enriched++;
        continue; // already has services
      }

      try {
        const services: SmService[] = await fetchOrderServices(session, order.id);
        order.services = services;
        enriched++;

        if ((i + 1) % 50 === 0) {
          console.log(
            `[migrate-parts]   Progress: ${i + 1}/${exportData.orders.length} orders (${enriched} enriched, ${failed} failed)`,
          );
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (failed <= 5) {
          console.warn(
            `[migrate-parts]   Failed to fetch services for order ${order.id} (#${order.number}): ${msg}`,
          );
        }
      }
    }

    console.log(
      `[migrate-parts] Service fetch complete: ${enriched} enriched, ${failed} failed`,
    );
  }

  // ── Step 6: Upload enriched export to S3 ─────────────────────────────────
  console.log('[migrate-parts] Uploading enriched export to S3...');
  const enrichedKey = await uploadEnrichedExport(s3Bucket, s3Key, exportData);
  console.log(`[migrate-parts] Saved to s3://${s3Bucket}/${enrichedKey}`);

  // Also write to /tmp for the wave loaders
  writeFileSync(TMP_EXPORT, JSON.stringify(exportData));

  // ── Step 7: Run migration waves ──────────────────────────────────────────
  const prisma = new PrismaClient({ datasourceUrl: process.env.DB_DATABASE_URL });
  const reports: WaveReport[] = [];

  try {
    if (wavesToRun.has('C')) {
      const r = await runTracked('C', 'Inventory Parts', () =>
        runWaveC(prisma, TMP_EXPORT, dryRun),
      );
      reports.push(r);
    }

    if (wavesToRun.has('F')) {
      const r = await runTracked('F', 'Vendors + POs', () =>
        runWaveF(prisma, TMP_EXPORT, dryRun),
      );
      reports.push(r);
    }

    if (wavesToRun.has('G')) {
      const r = await runTracked('G', 'Work Orders + Parts', () =>
        runWaveG(prisma, TMP_EXPORT, dryRun),
      );
      reports.push(r);
    }
  } finally {
    await prisma.$disconnect();
  }

  const totalInserted = reports.reduce((s, r) => s + r.inserted, 0);
  const totalErrors = reports.reduce((s, r) => s + r.errors, 0);

  const summary = {
    status: totalErrors > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
    inventoryPartsFetched: inventoryParts.length,
    ordersEnriched: exportData.orders.filter((o) => o.services && o.services.length > 0).length,
    enrichedExportKey: enrichedKey,
    totalInserted,
    totalErrors,
    waves: reports,
  };

  console.log(`[migrate-parts] Done: ${JSON.stringify(summary, null, 2)}`);
  return summary;
}

async function runTracked(
  wave: string,
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: () => Promise<any>,
): Promise<WaveReport> {
  console.log(`🚀 Wave ${wave} — ${label}`);
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;

    // Handle both flat LoadResult and composite (e.g. Wave F: { vendors, purchaseOrders })
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    if ('batchId' in result) {
      inserted = (result as { inserted: number }).inserted;
      skipped = (result as { skipped: number }).skipped;
      errors = (result as { errors: number }).errors;
    } else {
      for (const sub of Object.values(result)) {
        if (sub && typeof sub === 'object' && 'inserted' in sub) {
          const r = sub as { inserted: number; skipped: number; errors: number };
          inserted += r.inserted;
          skipped += r.skipped;
          errors += r.errors;
        }
      }
    }

    console.log(
      `  ✅ ${label}: ${inserted} inserted, ${skipped} skipped, ${errors} errors (${(durationMs / 1000).toFixed(1)}s)`,
    );
    return {
      wave,
      label,
      inserted,
      skipped,
      errors,
      durationMs,
      status: errors > 0 ? 'error' : 'ok',
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${label}: FAILED — ${message}`);
    return { wave, label, inserted: 0, skipped: 0, errors: 1, durationMs, status: 'error', error: message };
  }
}
