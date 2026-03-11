import { access, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const ensureEnvFile = async ({ source, target }) => {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(root, target);

  try {
    await access(targetPath);
    console.log(`✓ ${target} already exists`);
    return;
  } catch {
    // Continue and create from source template.
  }

  await copyFile(sourcePath, targetPath);
  console.log(`✓ Created ${target} from ${source}`);
};

async function main() {
  await ensureEnvFile({ source: '.env.example', target: '.env' });
  await ensureEnvFile({ source: '.env.test.example', target: '.env.test' });

  console.log('\nNext steps:');
  console.log('1) npm run db:up');
  console.log('2) npm run db:migrate');
  console.log('3) npm run dev:stack');
}

void main();
