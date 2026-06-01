import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const migrationsDir = path.resolve(process.cwd(), 'packages/db/prisma/migrations');
const schemaPath = path.resolve(process.cwd(), 'packages/db/prisma/schema.prisma');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeSqlIdentifier = (value) => value.replace(/^"|"$/g, '').toLowerCase();

function findCreateTableConstraintNames(migrationSql) {
  const constraintNames = new Set();
  const createTablePattern =
    /\bcreate\s+table\s+if\s+not\s+exists\s+(?:"?[a-zA-Z_][\w$]*"?\.)?"?[a-zA-Z_][\w$]*"?\s*\(([\s\S]*?)\n\);/gi;

  for (const match of migrationSql.matchAll(createTablePattern)) {
    const tableBody = match[1] ?? '';
    for (const constraintMatch of tableBody.matchAll(/\bconstraint\s+("[^"]+"|[a-zA-Z_][\w$]*)\b/gi)) {
      constraintNames.add(normalizeSqlIdentifier(constraintMatch[1]));
    }
  }

  return constraintNames;
}

function findUnsafeDuplicateConstraintAdds(migrationSql) {
  const inlineConstraintNames = findCreateTableConstraintNames(migrationSql);
  if (inlineConstraintNames.size === 0) {
    return [];
  }

  const statements = migrationSql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  const droppedConstraints = new Set();
  const unsafeDuplicates = [];

  for (const statement of statements) {
    const dropMatch = statement.match(
      /\balter\s+table\b[\s\S]*?\bdrop\s+constraint\s+if\s+exists\s+("[^"]+"|[a-zA-Z_][\w$]*)\b/i,
    );
    if (dropMatch) {
      droppedConstraints.add(normalizeSqlIdentifier(dropMatch[1]));
      continue;
    }

    const addMatch = statement.match(
      /\balter\s+table\b[\s\S]*?\badd\s+constraint\s+("[^"]+"|[a-zA-Z_][\w$]*)\b/i,
    );
    if (!addMatch) {
      continue;
    }

    const constraintName = normalizeSqlIdentifier(addMatch[1]);
    if (inlineConstraintNames.has(constraintName) && !droppedConstraints.has(constraintName)) {
      unsafeDuplicates.push(constraintName);
    }
  }

  return [...new Set(unsafeDuplicates)].sort();
}

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
  const unsafeDuplicateConstraintAdds = findUnsafeDuplicateConstraintAdds(migrationSql);
  if (unsafeDuplicateConstraintAdds.length > 0) {
    throw new Error(
      `migration.sql in "${migrationDirectory}" re-adds constraint(s) already defined in CREATE TABLE ` +
        `without first dropping them: ${unsafeDuplicateConstraintAdds.join(', ')}.`,
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
