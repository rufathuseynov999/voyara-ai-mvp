import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const directory = 'supabase/migrations';
const manifestPath = `${directory}/manifest.sha256`;
const migrationFiles = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const manifestLines = (await readFile(manifestPath, 'utf8')).trim().split('\n').filter(Boolean);
const expected = new Map();

for (const line of manifestLines) {
  const match = line.match(/^([0-9a-f]{64})  ([0-9]{14}_[a-z0-9_]+\.sql)$/);
  if (!match) throw new Error(`Invalid migration manifest line: ${line}`);
  expected.set(match[2], match[1]);
}

if (expected.size !== migrationFiles.length) {
  throw new Error(`Migration manifest count ${expected.size} does not match migration count ${migrationFiles.length}.`);
}

for (const file of migrationFiles) {
  const expectedHash = expected.get(file);
  if (!expectedHash) throw new Error(`Migration is missing from manifest: ${file}`);
  const actualHash = createHash('sha256').update(await readFile(`${directory}/${file}`)).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`Migration hash mismatch: ${file}`);
}

process.stdout.write(`Migration integrity PASS: ${migrationFiles.length} ordered immutable SQL files match manifest.sha256.\n`);
