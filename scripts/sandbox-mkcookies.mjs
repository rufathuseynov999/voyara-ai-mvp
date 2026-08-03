// Sandbox cookie generator: uses @supabase/ssr itself to serialize sessions so
// cookie names, chunking and encoding exactly match what the server reads.
// Synthetic sandbox accounts only.
import { createServerClient } from '@supabase/ssr';
import { readFileSync, writeFileSync } from 'node:fs';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const jwts = Object.fromEntries(
  readFileSync('/tmp/jwts.env', 'utf8').trim().split('\n').map((l) => l.split('=', 2))
);

async function cookiesFor(token) {
  const jar = [];
  const client = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => jar.map(({ name, value }) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => {
        const i = jar.findIndex((c) => c.name === name);
        if (i >= 0) jar[i] = { name, value }; else jar.push({ name, value });
      })
    }
  });
  const { error } = await client.auth.setSession({ access_token: token, refresh_token: token });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  return jar;
}

const out = {};
for (const user of ['CUSTA', 'CUSTB', 'FOUNDER']) {
  out[user] = await cookiesFor(jwts[user]);
  console.log(user, out[user].map((c) => c.name).join(','));
}
writeFileSync('/tmp/cookies.json', JSON.stringify(out));
console.log('cookies written');
