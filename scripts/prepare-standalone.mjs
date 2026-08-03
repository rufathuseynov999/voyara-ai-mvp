import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const standalone = resolve(root, '.next/standalone');
if (!existsSync(resolve(standalone, 'server.js'))) {
  throw new Error('Standalone Next.js output is missing. Run next build first.');
}

mkdirSync(resolve(standalone, '.next'), { recursive: true });
cpSync(resolve(root, 'public'), resolve(standalone, 'public'), { recursive: true });
cpSync(resolve(root, '.next/static'), resolve(standalone, '.next/static'), { recursive: true });
