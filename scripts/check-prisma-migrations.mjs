import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const migrationsDir = path.resolve(process.cwd(), 'packages/db/prisma/migrations');
const schemaPath = path.resolve(process.cwd(), 'packages/db/prisma/schema.prisma');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const migrationEntries = await readdir(migrationsDir, { withFileTypes: true });
const migrationDirectories = migrationEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const legacyDollarQuotedMigrations = new Set(['0002_work_orders_vertical_slice']);

if (migrationDirectories.length === 0) {
  throw new Error(`No migration directories found in ${migrationsDir}.`);
}

const schemaContents = await readFile(schemaPath, 'utf8');
const schemaNames = [
  ...new Set(
    [...schemaContents.matchAll(/@@schema\("([^"]+)"\)/g)].map((match) => match[1]),
  ),
];

const allMigrationSql = [];
for (const migrationDirectory of migrationDirectories) {
  if (!/^\d+_/.test(migrationDirectory)) {
    throw new Error(
      `Migration directory "${migrationDirectory}" must use "<number>_<name>" naming.`,
    );
  }

  const migrationSqlPath = path.join(migrationsDir, migrationDirectory, 'migration.sql');
  const migrationSqlStat = await stat(migrationSqlPath).catch(() => null);
  if (!migrationSqlStat?.isFile()) {
    throw new Error(`Missing migration.sql in "${migrationDirectory}".`);
  }

  const migrationSql = await readFile(migrationSqlPath, 'utf8');
  if (!migrationSql.trim()) {
    throw new Error(`migration.sql in "${migrationDirectory}" is empty.`);
  }
  if (!legacyDollarQuotedMigrations.has(migrationDirectory) && /\bDO\s+\$\$/i.test(migrationSql)) {
    throw new Error(
      `migration.sql in "${migrationDirectory}" uses a dollar-quoted DO block, ` +
        'which is incompatible with the Lambda migration runner semicolon splitter.',
    );
  }

  allMigrationSql.push(migrationSql);
}

const combinedMigrationSql = allMigrationSql.join('\n');
for (const schemaName of schemaNames) {
  const schemaCreatePattern = new RegExp(
    `create\\s+schema\\s+if\\s+not\\s+exists\\s+("?${escapeRegExp(schemaName)}"?)`,
    'i',
  );
  if (!schemaCreatePattern.test(combinedMigrationSql)) {
    throw new Error(
      `Missing "create schema if not exists ${schemaName}" statement in Prisma migrations.`,
    );
  }
}

console.log(
  `Prisma migration integrity checks passed for ${migrationDirectories.length} migration(s).`,
);
