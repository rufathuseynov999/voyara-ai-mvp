import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = '3100';
const origin = `http://127.0.0.1:${port}`;
const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
  ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
  : origin;
const server = spawn(process.execPath, ['scripts/start-standalone.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: port, VOYARA_HOSTNAME: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

async function waitUntilReady() {
  const startedAt = Date.now();
  while (!output.includes('Ready')) {
    if (server.exitCode !== null) throw new Error(`Standalone server exited early: ${output}`);
    if (Date.now() - startedAt > 10_000) throw new Error(`Standalone server did not become ready: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

try {
  await waitUntilReady();

  const root = await fetch(`${origin}/`, { redirect: 'manual' });
  assert.equal(root.status, 307);
  assert.equal(root.headers.get('location'), '/az');

  const liveness = await fetch(`${origin}/api/v1/health`, { redirect: 'manual' });
  assert.equal(liveness.status, 200);
  assert.deepEqual(await liveness.json(), {
    service: 'voyara-bos',
    status: 'ok',
    version: '0.12.0',
    authority: 'liveness-only'
  });
  const readiness = await fetch(`${origin}/api/v1/health/readiness`, { redirect: 'manual' });
  assert.equal(readiness.status, 401);
  assert.deepEqual(await readiness.json(), { error: 'HEALTH_AUTHENTICATION_REQUIRED' });
  assert.match(readiness.headers.get('x-robots-tag') ?? '', /noindex/);

  const wizard = await fetch(`${origin}/az/trip-wizard`, { redirect: 'manual' });
  assert.equal(wizard.status, 200);
  const wizardHtml = await wizard.text();
  assert.match(wizardHtml, /<html lang="az"/);
  assert.match(wizardHtml, /Sorğu yaratmaq üçün daxil olun/);
  assert.match(wizard.headers.get('content-security-policy') ?? '', /nonce-/);
  assert.match(wizard.headers.get('permissions-policy') ?? '', /camera=\(\)/);
  assert.match(wizard.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
  assert.equal(wizard.headers.get('cross-origin-resource-policy'), 'same-origin');

  const landing = await fetch(`${origin}/az`, { redirect: 'manual' });
  assert.equal(landing.status, 200);
  const landingHtml = await landing.text();
  const landingText = landingHtml.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '');
  for (const approvedPrice of ['19 ₼/ay', '190 ₼/il', '299 ₼/ay', '2.990 ₼/il', '149 ₼/ay', '599 ₼/ay']) {
    assert.match(landingText, new RegExp(approvedPrice.replace('.', '\\.')));
  }

  const cssPath = wizardHtml.match(/href="([^\"]+\.css)"/)?.[1];
  assert.ok(cssPath);
  assert.equal((await fetch(new URL(cssPath, origin))).status, 200);
  assert.equal((await fetch(`${origin}/brand/voyara-mark.png`)).status, 200);
  assert.equal((await fetch(`${origin}/brand/voyara-logo.jpg`)).status, 200);

  const crm = await fetch(`${origin}/az/staff/crm`, { redirect: 'manual' });
  assert.equal(crm.status, 307);
  assert.equal(crm.headers.get('location'), '/az/login?next=%2Faz%2Fstaff%2Fcrm');

  const approvals = await fetch(`${origin}/az/staff/approvals`, { redirect: 'manual' });
  assert.equal(approvals.status, 307);
  assert.equal(approvals.headers.get('location'), '/az/login?next=%2Faz%2Fstaff%2Fapprovals');

  const proposal = await fetch(`${origin}/az/proposal`, { redirect: 'manual' });
  assert.equal(proposal.status, 307);
  assert.equal(proposal.headers.get('location'), '/az/login?next=%2Faz%2Fproposal');

  const payment = await fetch(`${origin}/az/payment`, { redirect: 'manual' });
  assert.equal(payment.status, 307);
  assert.equal(payment.headers.get('location'), '/az/login?next=%2Faz%2Fpayment');

  const tripRoom = await fetch(`${origin}/az/trip-room`, { redirect: 'manual' });
  assert.equal(tripRoom.status, 307);
  assert.equal(tripRoom.headers.get('location'), '/az/login?next=%2Faz%2Ftrip-room');

  const finance = await fetch(`${origin}/az/staff/finance`, { redirect: 'manual' });
  assert.equal(finance.status, 307);
  assert.equal(finance.headers.get('location'), '/az/login?next=%2Faz%2Fstaff%2Ffinance');

  const bookings = await fetch(`${origin}/az/staff/bookings`, { redirect: 'manual' });
  assert.equal(bookings.status, 307);
  assert.equal(bookings.headers.get('location'), '/az/login?next=%2Faz%2Fstaff%2Fbookings');

  const support = await fetch(`${origin}/az/staff/support`, { redirect: 'manual' });
  assert.equal(support.status, 307);
  assert.equal(support.headers.get('location'), '/az/login?next=%2Faz%2Fstaff%2Fsupport');

  const founder = await fetch(`${origin}/az/staff/founder`, { redirect: 'manual' });
  assert.equal(founder.status, 307);
  assert.equal(founder.headers.get('location'), '/az/login?next=%2Faz%2Fstaff%2Ffounder');

  const missingOrigin = await fetch(`${origin}/api/v1/travel-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(missingOrigin.status, 403);
  assert.deepEqual(await missingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const orchestrationMissingOrigin = await fetch(`${origin}/api/v1/orchestration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(orchestrationMissingOrigin.status, 403);
  assert.deepEqual(await orchestrationMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const orchestrationMissingAuth = await fetch(`${origin}/api/v1/orchestration`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-orchestration-001'
    },
    body: '{}'
  });
  assert.equal(orchestrationMissingAuth.status, 401);
  assert.deepEqual(await orchestrationMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const missingAuth = await fetch(`${origin}/api/v1/travel-requests`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-smoke-0001'
    },
    body: '{}'
  });
  assert.equal(missingAuth.status, 401);
  assert.deepEqual(await missingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const commercialMissingOrigin = await fetch(`${origin}/api/v1/customer/commercial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(commercialMissingOrigin.status, 403);
  assert.deepEqual(await commercialMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const commercialMissingAuth = await fetch(`${origin}/api/v1/staff/commercial`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-commercial-001'
    },
    body: '{}'
  });
  assert.equal(commercialMissingAuth.status, 401);
  assert.deepEqual(await commercialMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const paymentMissingOrigin = await fetch(`${origin}/api/v1/customer/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(paymentMissingOrigin.status, 403);
  assert.deepEqual(await paymentMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const paymentMissingAuth = await fetch(`${origin}/api/v1/staff/payments`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-payment-0001'
    },
    body: '{}'
  });
  assert.equal(paymentMissingAuth.status, 401);
  assert.deepEqual(await paymentMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const bookingMissingOrigin = await fetch(`${origin}/api/v1/staff/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(bookingMissingOrigin.status, 403);
  assert.deepEqual(await bookingMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const bookingMissingAuth = await fetch(`${origin}/api/v1/staff/bookings`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-booking-0001'
    },
    body: '{}'
  });
  assert.equal(bookingMissingAuth.status, 401);
  assert.deepEqual(await bookingMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const fulfilmentMissingOrigin = await fetch(`${origin}/api/v1/staff/fulfilment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(fulfilmentMissingOrigin.status, 403);
  assert.deepEqual(await fulfilmentMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const fulfilmentMissingAuth = await fetch(`${origin}/api/v1/staff/fulfilment`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-fulfilment-01'
    },
    body: '{}'
  });
  assert.equal(fulfilmentMissingAuth.status, 401);
  assert.deepEqual(await fulfilmentMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const customerSupportMissingOrigin = await fetch(`${origin}/api/v1/customer/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(customerSupportMissingOrigin.status, 403);
  assert.deepEqual(await customerSupportMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const customerSupportMissingAuth = await fetch(`${origin}/api/v1/customer/support`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-customer-support-01'
    },
    body: '{}'
  });
  assert.equal(customerSupportMissingAuth.status, 401);
  assert.deepEqual(await customerSupportMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const staffSupportMissingOrigin = await fetch(`${origin}/api/v1/staff/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(staffSupportMissingOrigin.status, 403);
  assert.deepEqual(await staffSupportMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const staffSupportMissingAuth = await fetch(`${origin}/api/v1/staff/support`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-staff-support-001'
    },
    body: '{}'
  });
  assert.equal(staffSupportMissingAuth.status, 401);
  assert.deepEqual(await staffSupportMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });

  const administrationMissingOrigin = await fetch(`${origin}/api/v1/staff/administration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(administrationMissingOrigin.status, 403);
  assert.deepEqual(await administrationMissingOrigin.json(), { error: 'REQUEST_ORIGIN_DENIED' });

  const administrationMissingAuth = await fetch(`${origin}/api/v1/staff/administration`, {
    method: 'POST',
    headers: {
      Origin: configuredOrigin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'runtime-administration-01'
    },
    body: '{}'
  });
  assert.equal(administrationMissingAuth.status, 401);
  assert.deepEqual(await administrationMissingAuth.json(), { error: 'AUTHENTICATION_REQUIRED' });


  // Three-language route matrix: public routes render per-locale; protected routes
  // redirect to the locale-correct login (role protection remains operational).
  const localePrices = {
    az: ['19 ₼/ay', '190 ₼/il', '299 ₼/ay'],
    ru: ['19 ₼/мес.', '190 ₼/год', '299 ₼/мес.'],
    en: ['19 ₼/month', '190 ₼/year', '299 ₼/month']
  };
  for (const loc of ['az', 'ru', 'en']) {
    for (const path of ['', '/trip-wizard', '/login']) {
      const res = await fetch(`${origin}/${loc}${path}`, { redirect: 'manual' });
      assert.equal(res.status, 200, `expected 200 for /${loc}${path}`);
      const html = await res.text();
      assert.ok(html.includes(`<html lang="${loc}"`), `lang attribute for /${loc}${path}`);
    }
    const demoRes = await fetch(`${origin}/${loc}/demo`, { redirect: 'manual' });
    assert.equal(demoRes.status, 307, `expected /demo to redirect for /${loc}`);
    assert.ok((demoRes.headers.get('location') ?? '').startsWith(`/${loc}`), `demo redirects into locale for /${loc}`);
    const localeLandingText = (await (await fetch(`${origin}/${loc}`)).text()).replace(/<[^>]+>/g, '');
    for (const price of localePrices[loc]) {
      assert.ok(localeLandingText.includes(price), `approved price ${price} on /${loc}`);
    }
    for (const guarded of ['/staff/crm', '/staff/approvals', '/proposal', '/payment', '/trip-room', '/staff/founder']) {
      const res = await fetch(`${origin}/${loc}${guarded}`, { redirect: 'manual' });
      assert.equal(res.status, 307, `expected redirect for /${loc}${guarded}`);
      const location = res.headers.get('location') ?? '';
      assert.ok(location.startsWith(`/${loc}/login`), `locale-correct login redirect for /${loc}${guarded}`);
    }
  }

  process.stdout.write('Runtime smoke PASS: public liveness, private readiness boundary, approved locale-formatted public prices, three-language route matrix (az/ru/en), localized wizard, hardened headers, protected CRM/Approval/Proposal/Payment/Finance/Trip Room/Booking/Support/Founder routes, static assets, and all command API origin/auth boundaries.\n');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(resolve, 2_000).unref();
  });
}
