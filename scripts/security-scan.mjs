import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.next', 'node_modules', 'artifacts', 'test-results', '.supabase']);
const textExtensions = new Set(['.cjs', '.css', '.env', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.yml', '.yaml']);
// Phase 3C: per-environment templates alongside .env.example — all
// placeholder-only, same treatment as .env.example (content-scanned below,
// and the only .env* filenames permitted to exist at the repo root at all).
const approvedEnvTemplateNames = new Set([
  '.env.example',
  '.env.local.example',
  '.env.preview.example',
  '.env.production.example'
]);
const findings = [];

async function filesUnder(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await filesUnder(path));
    else if (textExtensions.has(extname(entry.name)) || approvedEnvTemplateNames.has(entry.name)) results.push(path);
  }
  return results;
}

function add(file, rule) {
  findings.push(`${relative(root, file)}: ${rule}`);
}

for (const file of await filesUnder(root)) {
  const path = relative(root, file);
  const content = await readFile(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) add(file, 'private key material');
  if (/\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/.test(content)) add(file, 'provider secret key');
  if (/\bAKIA[0-9A-Z]{16}\b/.test(content)) add(file, 'AWS access key');
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(content)) add(file, 'JWT-like credential');
  if (/\bsb_secret_[A-Za-z0-9_-]{32,}\b/.test(content)) add(file, 'Supabase secret-like value');
  if (
    !path.startsWith('tests/')
    && !path.startsWith('docs/')
    && /NEXT_PUBLIC_(?:SUPABASE_SECRET|SERVICE_ROLE|DATABASE_URL)/.test(content)
  ) add(file, 'server secret exposed with NEXT_PUBLIC_');
  if (path.startsWith('public/') && /(?:passport|payment|supplier|customer).*(?:\.json|\.csv)$/i.test(path)) {
    add(file, 'sensitive fixture in public assets');
  }
  if (path.startsWith('src/fixtures/') || path === 'supabase/seed.sql') {
    const emails = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const email of emails) {
      if (!email.endsWith('@voyara.example')) add(file, `non-synthetic fixture email ${email}`);
    }
  }
  if (path === '.github/workflows/verify.yml' && /supabase db reset(?![^\n]*--no-seed)/.test(content)) {
    add(file, 'CI database reset can apply the local synthetic seed');
  }
  if (content.startsWith("'use client'") || content.startsWith('"use client"')) {
    if (/createAdminSupabaseClient|SUPABASE_SECRET_KEY|DATABASE_URL/.test(content)) add(file, 'client module references server authority');
  }
}

const rootEntries = await readdir(root);
for (const entry of rootEntries) {
  if (entry.startsWith('.env') && !approvedEnvTemplateNames.has(entry)) findings.push(`${entry}: unapproved environment file`);
}

if (findings.length > 0) {
  process.stderr.write(`Security scan FAILED (${findings.length})\n${findings.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Security scan PASS: no committed credential signatures, public sensitive fixtures, unsafe client authority imports or seeded CI reset.\n');
}
