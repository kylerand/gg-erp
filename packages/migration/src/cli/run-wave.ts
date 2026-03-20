#!/usr/bin/env tsx
/**
 * Migration wave runner CLI.
 *
 * Usage:
 *   npm run migrate A
 *   npm run migrate B ./path/to/employees.csv
 *   npm run migrate C ./path/to/shopmonkey-export.json
 *   npm run migrate D ./path/to/shopmonkey-export.json
 *   npm run migrate E ./path/to/shopmonkey-export.json
 *   npm run migrate F ./path/to/shopmonkey-export.json
 *   npm run migrate G ./path/to/shopmonkey-export.json
 *   npm run migrate H
 *   npm run migrate H --dry-run    (requires SM_EMAIL + SM_PASSWORD in env)
 *
 * Requires DB_DATABASE_URL in environment (or root .env loaded externally).
 */

import { PrismaClient } from '@prisma/client';
import { runWaveA, runWaveB, runWaveC, runWaveD, runWaveE, runWaveF, runWaveG } from '../loaders/index.js';
import { runWaveH } from '../loaders/wave-h.loader.js';

async function main() {
  const args = process.argv.slice(2);
  const wave = args[0]?.toUpperCase();
  const sourceFile = args.find((a) => !a.startsWith('-') && a !== wave);
  const dryRun = args.includes('--dry-run');

  if (!wave) {
    console.error('Usage: npm run migrate <wave> [sourceFile] [--dry-run]');
    console.error('  Waves: A B C D E F G');
    process.exit(1);
  }

  const WAVES_NEEDING_SOURCE = ['B', 'C', 'D', 'E', 'F', 'G'];
  if (WAVES_NEEDING_SOURCE.includes(wave) && !sourceFile) {
    console.error(`Wave ${wave} requires a sourceFile argument.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();

  console.log(`\n🚀 Running Wave ${wave}${dryRun ? ' (DRY RUN)' : ''}${sourceFile ? ` from ${sourceFile}` : ''}\n`);

  try {
    switch (wave) {
      case 'A': {
        const r = await runWaveA(prisma, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'B': {
        const r = await runWaveB(prisma, sourceFile!, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'C': {
        const r = await runWaveC(prisma, sourceFile!, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'D': {
        const r = await runWaveD(prisma, sourceFile!, undefined, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'E': {
        const r = await runWaveE(prisma, sourceFile!, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'F': {
        const r = await runWaveF(prisma, sourceFile!, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'G': {
        const r = await runWaveG(prisma, sourceFile!, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'H': {
        // Wave H fetches directly from ShopMonkey API — no sourceFile needed
        // Requires SM_EMAIL and SM_PASSWORD env vars
        const r = await runWaveH(`wave-h-${Date.now()}`, dryRun);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      default:
        console.error(`Unknown wave: ${wave}. Valid waves: A B C D E F G H`);
        process.exit(1);
    }

    console.log(`\n✅ Wave ${wave} complete.\n`);
  } catch (err) {
    console.error(`\n❌ Wave ${wave} failed:\n`, err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
