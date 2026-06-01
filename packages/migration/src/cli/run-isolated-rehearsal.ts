#!/usr/bin/env tsx
/**
 * Runs the ShopMonkey loader against a disposable local PostgreSQL database.
 *
 * The default path starts a throwaway postgres:16-alpine container, applies
 * Prisma migrations, runs the loader, captures row-count reconciliation, and
 * writes JSON/HTML evidence. It refuses non-local database URLs.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { readShopMonkeySource } from '../loaders/shopmonkey-source.js';
import {
  assertSafeRehearsalDatabaseUrl,
  buildIsolatedRehearsalReport,
  renderIsolatedRehearsalHtml,
  type RehearsalCommandReport,
} from '../validation/isolated-rehearsal.js';

interface CliConfig {
  sourceFile: string;
  jsonOut: string;
  htmlOut: string;
  dbUrl?: string;
  keepContainer: boolean;
  skipWaves?: string;
  onlyWaves?: string;
}

interface CommandResult extends RehearsalCommandReport {
  stdout: string;
  stderr: string;
}

interface DockerDatabase {
  containerName: string;
  image: string;
  dbUrl: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_SOURCE = 'packages/migration/shopmonkey-sanitized-1773274402708.json';
const DEFAULT_JSON = 'docs/operations/shopmonkey-isolated-rehearsal.json';
const DEFAULT_HTML = 'docs/operations/shopmonkey-isolated-rehearsal.html';

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  const sourceFile = args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_SOURCE;
  return {
    sourceFile,
    jsonOut: args.find((arg) => arg.startsWith('--json='))?.replace('--json=', '') ?? DEFAULT_JSON,
    htmlOut: args.find((arg) => arg.startsWith('--html='))?.replace('--html=', '') ?? DEFAULT_HTML,
    dbUrl: args.find((arg) => arg.startsWith('--db-url='))?.replace('--db-url=', ''),
    keepContainer: args.includes('--keep-container'),
    skipWaves: args.find((arg) => arg.startsWith('--skip='))?.replace('--skip=', ''),
    onlyWaves: args.find((arg) => arg.startsWith('--only='))?.replace('--only=', ''),
  };
}

function trimTail(value: string, maxChars = 12_000): string {
  return value.length > maxChars ? value.slice(value.length - maxChars) : value;
}

async function runCommand(
  name: string,
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; stream?: boolean; reportCommand?: string } = {},
): Promise<CommandResult> {
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout = trimTail(stdout + text);
    if (options.stream !== false) process.stdout.write(text);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr = trimTail(stderr + text);
    if (options.stream !== false) process.stderr.write(text);
  });

  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.on('error', () => resolveExit(1));
    child.on('close', (code) => resolveExit(code));
  });

  return {
    name,
    command: options.reportCommand ?? [command, ...args].join(' '),
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    exitCode,
    durationMs: Date.now() - started,
    stdout,
    stderr,
  };
}

function toCommandReport(result: CommandResult): RehearsalCommandReport {
  return {
    name: result.name,
    command: result.command,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
}

async function waitForPostgres(containerName: string): Promise<void> {
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = await runCommand(
      'Wait for PostgreSQL',
      'docker',
      ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'gg_erp_rehearsal'],
      { stream: false },
    );
    if (result.exitCode === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error('Disposable PostgreSQL container did not become ready within 45 seconds.');
}

async function startDockerDatabase(keepContainer: boolean): Promise<{ database: DockerDatabase; command: CommandResult }> {
  const image = 'postgres:16-alpine';
  const containerName = `gg-erp-shopmonkey-rehearsal-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const args = [
    'run',
    '-d',
    ...(keepContainer ? [] : ['--rm']),
    '--name',
    containerName,
    '-e',
    'POSTGRES_DB=gg_erp_rehearsal',
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-p',
    '127.0.0.1::5432',
    image,
  ];
  const command = await runCommand('Start disposable PostgreSQL', 'docker', args, {
    stream: true,
    reportCommand: `docker run -d --name ${containerName} -p 127.0.0.1::5432 ${image}`,
  });
  if (command.exitCode !== 0) {
    throw new Error('Failed to start disposable PostgreSQL container.');
  }

  await waitForPostgres(containerName);
  const portResult = await runCommand('Inspect PostgreSQL port', 'docker', ['port', containerName, '5432/tcp'], { stream: false });
  const port = portResult.stdout.match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) throw new Error(`Could not determine mapped PostgreSQL port for ${containerName}.`);

  const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/gg_erp_rehearsal`;
  assertSafeRehearsalDatabaseUrl(dbUrl);
  return { database: { containerName, image, dbUrl }, command };
}

async function stopDockerDatabase(database: DockerDatabase): Promise<void> {
  await runCommand('Stop disposable PostgreSQL', 'docker', ['stop', database.containerName], { stream: false });
}

async function writeText(path: string, text: string): Promise<void> {
  const resolved = resolve(repoRoot, path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, text, 'utf8');
}

async function countSql(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(sql);
  return Number(rows[0]?.count ?? 0);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlStrings(values: readonly string[]): string {
  return values.map(sqlString).join(', ');
}

function sqlStringRows(values: ReadonlyArray<readonly string[]>): string {
  return values.map((row) => `(${row.map(sqlString).join(', ')})`).join(', ');
}

async function collectCounts(dbUrl: string) {
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  try {
    const baselineRoleCodes = [
      'ERP_ADMIN',
      'SHOP_MANAGER',
      'DISPATCH_PLANNER',
      'TECHNICIAN',
      'PARTS_COORDINATOR',
      'TRAINING_COORDINATOR',
      'ACCOUNTING_OPERATOR',
      'INTEGRATION_OPERATOR',
    ];
    const baselinePermissionCodes = [
      'identity.users.read',
      'identity.users.manage_roles',
      'customers.read',
      'customers.write',
      'work_orders.read',
      'work_orders.write',
      'work_orders.assign',
      'inventory.read',
      'inventory.reserve',
      'inventory.adjust',
      'planning.read',
      'planning.run',
      'planning.publish',
      'sop_ojt.read',
      'sop_ojt.assign_training',
      'sop_ojt.manage_content',
      'sales.read',
      'sales.write',
      'accounting.read',
      'accounting.sync.manage',
      'integrations.read',
      'integrations.manage',
      'audit.read',
      'ops.retry_dead_letter',
    ];
    const stockLocationCodes = ['HQ-WH', 'HQ-STAGE', 'HQ-BAY-01', 'HQ-BAY-02'];
    const stockBinPairs = [
      ['HQ-WH', 'GENERAL'],
      ['HQ-STAGE', 'INBOUND'],
      ['HQ-BAY-01', 'WIP'],
      ['HQ-BAY-02', 'WIP'],
    ] as const;
    const planningConstraintKeys = ['SKILL_REQUIRED', 'MATERIAL_READY_REQUIRED', 'DUE_DATE_WEIGHT', 'MAX_SHIFT_MINUTES'];

    const mappingCount = (entityType: string) =>
      countSql(
        prisma,
        `SELECT COUNT(*) AS count FROM integrations.external_id_mappings WHERE namespace = 'shopmonkey:v1' AND entity_type = '${entityType}'`,
      );

    const [
      employees,
      employeeMappings,
      customers,
      customerMappings,
      vehicles,
      vehicleMappings,
      parts,
      partMappings,
      vendors,
      vendorMappings,
      purchaseOrders,
      purchaseOrderMappings,
      workOrders,
      workOrderMappings,
      operations,
      workOrderParts,
      importBatches,
      migrationErrors,
      baselineRoles,
      baselinePermissions,
      erpAdminGrants,
      stockLocations,
      stockBins,
      mvpScenario,
      mvpConstraints,
      dealerTables,
    ] = await Promise.all([
      countSql(prisma, 'SELECT COUNT(*) AS count FROM hr.employees'),
      mappingCount('EMPLOYEE'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM customers.customers'),
      mappingCount('CUSTOMER'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM planning.cart_vehicles'),
      mappingCount('ASSET'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM inventory.parts'),
      mappingCount('PART'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM inventory.vendors'),
      mappingCount('VENDOR'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM inventory.purchase_orders'),
      mappingCount('PURCHASE_ORDER'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM work_orders.work_orders'),
      mappingCount('WORK_ORDER'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM work_orders.work_order_operations'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM work_orders.work_order_parts'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM migration."ImportBatch"'),
      countSql(prisma, 'SELECT COUNT(*) AS count FROM migration."MigrationError"'),
      countSql(
        prisma,
        `SELECT COUNT(DISTINCT role_code) AS count
         FROM identity.roles
         WHERE deleted_at IS NULL
           AND role_code IN (${sqlStrings(baselineRoleCodes)})`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(DISTINCT permission_code) AS count
         FROM identity.permissions
         WHERE deleted_at IS NULL
           AND permission_code IN (${sqlStrings(baselinePermissionCodes)})`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(DISTINCT permissions.permission_code) AS count
         FROM identity.role_permissions grants
         JOIN identity.roles roles
           ON roles.id = grants.role_id
          AND roles.deleted_at IS NULL
         JOIN identity.permissions permissions
           ON permissions.id = grants.permission_id
          AND permissions.deleted_at IS NULL
         WHERE roles.role_code = 'ERP_ADMIN'
           AND permissions.permission_code IN (${sqlStrings(baselinePermissionCodes)})`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(DISTINCT location_code) AS count
         FROM inventory.stock_locations
         WHERE deleted_at IS NULL
           AND location_code IN (${sqlStrings(stockLocationCodes)})`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(*) AS count
         FROM (VALUES ${sqlStringRows(stockBinPairs)}) AS expected(location_code, bin_code)
         WHERE EXISTS (
           SELECT 1
           FROM inventory.stock_bins bins
           JOIN inventory.stock_locations locations
             ON locations.id = bins.stock_location_id
            AND locations.deleted_at IS NULL
           WHERE bins.deleted_at IS NULL
             AND bins.bin_state = 'ACTIVE'
             AND locations.location_code = expected.location_code
             AND bins.bin_code = expected.bin_code
         )`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(*) AS count
         FROM planning.planning_scenarios
         WHERE scenario_name = 'MVP_BASELINE'
           AND scenario_status = 'ACTIVE'`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(DISTINCT constraints.constraint_key) AS count
         FROM planning.planning_constraints constraints
         JOIN planning.planning_scenarios scenarios
           ON scenarios.id = constraints.scenario_id
          AND scenarios.scenario_name = 'MVP_BASELINE'
          AND scenarios.scenario_status = 'ACTIVE'
         WHERE constraints.is_enabled = TRUE
           AND constraints.constraint_key IN (${sqlStrings(planningConstraintKeys)})`,
      ),
      countSql(
        prisma,
        `SELECT COUNT(*) AS count
         FROM (VALUES ('customers.dealer_accounts'), ('customers.customer_dealer_relationships')) AS expected(table_name)
         WHERE to_regclass(expected.table_name) IS NOT NULL`,
      ),
    ]);

    return {
      entities: [
        { key: 'users', label: 'Employees', required: true, importedRows: employees, mappedRows: employeeMappings },
        { key: 'customers', label: 'Customers', required: true, importedRows: customers, mappedRows: customerMappings },
        { key: 'vehicles', label: 'Vehicles', required: true, importedRows: vehicles, mappedRows: vehicleMappings },
        { key: 'orders', label: 'Work Orders', required: true, importedRows: workOrders, mappedRows: workOrderMappings },
        { key: 'vendors', label: 'Vendors', required: true, importedRows: vendors, mappedRows: vendorMappings },
        { key: 'parts', label: 'Parts', required: false, importedRows: parts, mappedRows: partMappings },
        {
          key: 'purchaseOrders',
          label: 'Purchase Orders',
          required: false,
          importedRows: purchaseOrders,
          mappedRows: purchaseOrderMappings,
        },
      ],
      supportingCounts: {
        'Work order operations': operations,
        'Work order part lines': workOrderParts,
        'Migration batches': importBatches,
        'Migration errors': migrationErrors,
      },
      referenceSeeds: [
        { key: 'baselineRoles', label: 'Baseline roles', expected: baselineRoleCodes.length, actual: baselineRoles },
        {
          key: 'baselinePermissions',
          label: 'Baseline permissions',
          expected: baselinePermissionCodes.length,
          actual: baselinePermissions,
        },
        {
          key: 'erpAdminGrants',
          label: 'ERP admin permission grants',
          expected: baselinePermissionCodes.length,
          actual: erpAdminGrants,
        },
        { key: 'stockLocations', label: 'Stock locations', expected: stockLocationCodes.length, actual: stockLocations },
        { key: 'stockBins', label: 'Stock bins', expected: stockBinPairs.length, actual: stockBins },
        { key: 'mvpScenario', label: 'MVP planning scenario', expected: 1, actual: mvpScenario },
        {
          key: 'mvpConstraints',
          label: 'MVP planning constraints',
          expected: planningConstraintKeys.length,
          actual: mvpConstraints,
        },
        { key: 'dealerTables', label: 'Dealer relationship tables', expected: 2, actual: dealerTables },
      ],
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const config = parseArgs();
  const sourcePath = resolve(repoRoot, config.sourceFile);
  const source = await readShopMonkeySource(sourcePath);
  const commands: RehearsalCommandReport[] = [];
  let dockerDatabase: DockerDatabase | undefined;
  let dbUrl = config.dbUrl;
  let failureDetail: string | undefined;
  let collected:
    | Awaited<ReturnType<typeof collectCounts>>
    | undefined;

  try {
    if (dbUrl) {
      assertSafeRehearsalDatabaseUrl(dbUrl);
    } else {
      const started = await startDockerDatabase(config.keepContainer);
      dockerDatabase = started.database;
      dbUrl = started.database.dbUrl;
      commands.push(toCommandReport(started.command));
    }

    const migrateResult = await runCommand(
      'Apply Prisma migrations',
      'npm',
      ['run', 'db:deploy', '--workspace=packages/db'],
      { env: { DB_DATABASE_URL: dbUrl } },
    );
    commands.push(toCommandReport(migrateResult));

    if (migrateResult.exitCode === 0) {
      const loaderArgs = ['tsx', 'packages/migration/src/cli/load-shopmonkey.ts', sourcePath];
      if (config.skipWaves) loaderArgs.push(`--skip=${config.skipWaves}`);
      if (config.onlyWaves) loaderArgs.push(`--only=${config.onlyWaves}`);
      const loaderResult = await runCommand(
        'Run ShopMonkey loader',
        'npx',
        loaderArgs,
        {
          env: { DB_DATABASE_URL: dbUrl },
          reportCommand: `npx tsx packages/migration/src/cli/load-shopmonkey.ts ${relative(repoRoot, sourcePath)}`,
        },
      );
      commands.push(toCommandReport(loaderResult));
    }

    if (dbUrl) {
      try {
        collected = await collectCounts(dbUrl);
        if ((collected.supportingCounts['Migration errors'] ?? 0) > 0) {
          failureDetail = 'Migration errors were recorded during the isolated rehearsal.';
        }
      } catch (error) {
        failureDetail = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error) {
    failureDetail = error instanceof Error ? error.message : String(error);
  } finally {
    if (dockerDatabase && !config.keepContainer) {
      await stopDockerDatabase(dockerDatabase);
    }
  }

  const sourceCounts = source.report.counts;
  const dbEntities = new Map(
    (collected?.entities ?? []).map((entity) => [entity.key, entity]),
  );
  const report = buildIsolatedRehearsalReport({
    sourceFile: relative(repoRoot, sourcePath),
    sourceKind: source.sourceKind,
    database: {
      mode: config.dbUrl ? 'provided-local-url' : 'disposable-docker',
      image: dockerDatabase?.image ?? 'postgres:16-alpine',
      containerName: config.keepContainer ? dockerDatabase?.containerName : undefined,
      keptContainer: config.keepContainer,
    },
    commands,
    entities: [
      { key: 'users', label: 'Employees', required: true },
      { key: 'customers', label: 'Customers', required: true },
      { key: 'vehicles', label: 'Vehicles', required: true },
      { key: 'orders', label: 'Work Orders', required: true },
      { key: 'vendors', label: 'Vendors', required: true },
      { key: 'parts', label: 'Parts', required: false },
      { key: 'purchaseOrders', label: 'Purchase Orders', required: false },
    ].map((entity) => {
      const counts = sourceCounts[entity.key as keyof typeof sourceCounts];
      const dbEntity = dbEntities.get(entity.key);
      return {
        ...entity,
        sourceRows: counts.total,
        sourceSkipped: counts.skipped,
        importedRows: dbEntity?.importedRows ?? 0,
        mappedRows: dbEntity?.mappedRows ?? 0,
      };
    }),
    referenceSeeds: collected?.referenceSeeds,
    supportingCounts: collected?.supportingCounts,
    failureDetail,
  });

  await writeText(config.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  await writeText(config.htmlOut, renderIsolatedRehearsalHtml(report));

  console.log(`ShopMonkey isolated rehearsal: ${report.overallStatus}`);
  console.log(`JSON: ${config.jsonOut}`);
  console.log(`HTML: ${config.htmlOut}`);
  process.exit(report.overallStatus === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
  console.error('[run-isolated-rehearsal] Fatal error:', error);
  process.exit(1);
});
