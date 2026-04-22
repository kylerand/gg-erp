import { join } from 'node:path';
import { runSeed } from '../../../../../packages/db/prisma/seed-inventory-master.js';

/**
 * Lambda handler that seeds inventory master data from the bundled xlsx.
 *
 * Invoked directly (not via API Gateway) — either manually or via the
 * `seed_inventory_master` input on the CD workflow_dispatch.
 *
 * The xlsx is copied next to this file at build time (see scripts/build-lambdas.ts)
 * so it lives alongside the handler JS at /var/task/inventory-master.xlsx.
 */

export async function handler(): Promise<{ statusCode: number; body: string }> {
  try {
    const filePath = join(__dirname, 'inventory-master.xlsx');
    const result = await runSeed(filePath);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, result }),
    };
  } catch (error) {
    console.error('seed-inventory-master error', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}
