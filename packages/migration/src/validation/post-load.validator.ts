import type { PrismaClient, ImportEntityType } from '@prisma/client';

export interface ReconciliationReport {
  entityType: string;
  sourceCount: number;
  importedCount: number;
  mappedCount: number;
  skippedCount: number;
  errorCount: number;
  status: 'OK' | 'WARN' | 'FAIL';
}

export async function reconcileEntity(
  prisma: PrismaClient,
  entityType: string,
  sourceCount: number,
): Promise<ReconciliationReport> {
  const mappedResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM integrations.external_id_mappings
    WHERE namespace = 'shopmonkey:v1' AND entity_type = ${entityType}
  `;
  const mappedCount = Number(mappedResult[0]?.count ?? 0);

  const errorResult = await prisma.migrationError.count({
    where: { phase: 'LOAD', rawRecord: { entityType: entityType as ImportEntityType } },
  });

  const importedCount = mappedCount;
  const skippedCount = sourceCount - importedCount - errorResult;

  return {
    entityType,
    sourceCount,
    importedCount,
    mappedCount,
    skippedCount,
    errorCount: errorResult,
    status: errorResult === 0 ? 'OK' : errorResult < sourceCount * 0.01 ? 'WARN' : 'FAIL',
  };
}

export function printReconciliationReport(reports: ReconciliationReport[]): void {
  console.log('\n=== Post-Load Reconciliation Report ===\n');
  for (const r of reports) {
    const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
    console.log(`${icon} ${r.entityType}`);
    console.log(`   Source: ${r.sourceCount} | Imported: ${r.importedCount} | Skipped: ${r.skippedCount} | Errors: ${r.errorCount}`);
  }
  const allOk = reports.every(r => r.status !== 'FAIL');
  console.log(`\n${allOk ? '✅ Reconciliation PASSED' : '❌ Reconciliation FAILED'}`);
}
