import { chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const execute = process.argv.includes('--execute');
if (!execute) {
  process.stdout.write('Backup plan PASS: execution requires --execute, DATABASE_URL and VOYARA_BACKUP_CONFIRM=BACKUP_CONTAINS_SENSITIVE_DATA.\n');
  process.exit(0);
}

if (process.env.VOYARA_BACKUP_CONFIRM !== 'BACKUP_CONTAINS_SENSITIVE_DATA') {
  throw new Error('Backup confirmation is missing.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const database = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');

const available = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
if (available.status !== 0) throw new Error('pg_dump is unavailable. Install matching PostgreSQL client tools.');

const backupDirectory = resolve('artifacts/backups');
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
chmodSync(backupDirectory, 0o700);
const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
const output = resolve(backupDirectory, `voyara-${timestamp}.dump`);
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', output], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PGHOST: database.hostname,
    PGPORT: database.port || '5432',
    PGDATABASE: database.pathname.slice(1),
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGSSLMODE: database.searchParams.get('sslmode') || 'require',
    PGCONNECT_TIMEOUT: '10'
  }
});
if (result.status !== 0) throw new Error('pg_dump failed; no successful backup is claimed.');
chmodSync(output, 0o600);
process.stdout.write(`Database backup created at ${output}. Treat it as sensitive Customer and commercial data.\n`);
