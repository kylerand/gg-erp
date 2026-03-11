import { resolveDatabaseUrl } from '../src/client.js';

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  console.info('Seed scaffold invoked for DB URL:', url.replace(/:[^:@/]+@/, ':***@'));
  console.info('No seed records are inserted by default. Extend this file for environment-specific data.');
}

void main();
