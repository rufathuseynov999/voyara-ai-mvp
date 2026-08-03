import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const execute = process.argv.includes('--execute');
const backupArgument = process.argv.find((argument) => argument.startsWith('--backup='));
if (!execute) {
  process.stdout.write('Restore rehearsal plan PASS: execution requires --execute, --backup, an isolated staging URL and explicit non-Production confirmation.\n');
  process.exit(0);
}

if (process.env.VOYARA_RESTORE_CONFIRM !== 'NON_PRODUCTION_ONLY' || process.env.VOYARA_RESTORE_TARGET !== 'staging') {
  throw new Error('Restore rehearsal is permitted only for an explicitly confirmed staging target.');
}
if (!process.env.VOYARA_RESTORE_DATABASE_URL) throw new Error('VOYARA_RESTORE_DATABASE_URL is required.');
if (!process.env.VOYARA_PRODUCTION_DATABASE_HOST) throw new Error('VOYARA_PRODUCTION_DATABASE_HOST is required for target separation.');
if (!backupArgument) throw new Error('--backup=/absolute/or/relative/file.dump is required.');

const backup = resolve(backupArgument.slice('--backup='.length));
if (!existsSync(backup)) throw new Error('Backup file does not exist.');
const database = new URL(process.env.VOYARA_RESTORE_DATABASE_URL);
if (database.hostname === process.env.VOYARA_PRODUCTION_DATABASE_HOST) {
  throw new Error('Restore target matches the Production database host.');
}

for (const command of ['pg_restore', 'psql']) {
  if (spawnSync(command, ['--version'], { encoding: 'utf8' }).status !== 0) {
    throw new Error(`${command} is unavailable. Install matching PostgreSQL client tools.`);
  }
}

const databaseEnvironment = {
  ...process.env,
  PGHOST: database.hostname,
  PGPORT: database.port || '5432',
  PGDATABASE: database.pathname.slice(1),
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGSSLMODE: database.searchParams.get('sslmode') || 'require',
  PGCONNECT_TIMEOUT: '10'
};
const restore = spawnSync(
  'pg_restore',
  ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', backup],
  { stdio: 'inherit', env: databaseEnvironment }
);
if (restore.status !== 0) throw new Error('Staging restore failed.');

const verify = spawnSync(
  'psql',
  ['--tuples-only', '--no-align', '--command', 'select count(*) from supabase_migrations.schema_migrations;'],
  { encoding: 'utf8', env: databaseEnvironment }
);
if (verify.status !== 0 || !/^\d+$/m.test(verify.stdout.trim())) {
  throw new Error('Restored migration history verification failed.');
}
process.stdout.write(`Staging restore rehearsal PASS: ${verify.stdout.trim()} migration records found.\n`);
