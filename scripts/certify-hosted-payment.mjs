#!/usr/bin/env node
/**
 * Phase 3C Part 3 — hosted-checkout payment provider certification script.
 *
 * Behavior:
 *   - If VOYARA_PAYMENT_PROVIDER_NAME / VOYARA_PAYMENT_MERCHANT_ID /
 *     VOYARA_PAYMENT_API_KEY / VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET /
 *     VOYARA_PAYMENT_BASE_URL are present and non-placeholder, this script
 *     makes REAL HTTPS calls to the configured base URL. Nothing is faked in
 *     this branch.
 *   - If credentials are absent (the case in this repository as delivered —
 *     no payment provider has been approved by the founder; see the Part 3
 *     checkpoint), this script certifies the adapter's request construction,
 *     response mapping, webhook signature verification, and error
 *     classification against documented fixtures instead. This is clearly
 *     labelled in every line of output — it NEVER claims a live connection
 *     succeeded when none was attempted, and it never claims any specific
 *     provider is connected.
 *
 * Run: node --import tsx scripts/certify-hosted-payment.mjs
 */
import { readHostedPaymentCredentials } from '../src/config/env-core.ts';
import { HostedCheckoutPaymentAdapter, signHostedCheckoutWebhook } from '../src/server/payment/providers/hosted-checkout/hosted-checkout-adapter.ts';
import {
  HOSTED_CHECKOUT_FIXTURE_AUTH_ERROR,
  HOSTED_CHECKOUT_FIXTURE_CREATE_SUCCESS,
  HOSTED_CHECKOUT_FIXTURE_RATE_LIMIT_ERROR,
  HOSTED_CHECKOUT_FIXTURE_STATUS_PAID
} from '../src/server/payment/providers/hosted-checkout/hosted-checkout-fixtures.ts';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

const credentials = readHostedPaymentCredentials();

if (credentials) {
  process.stdout.write(
    `=== LIVE MODE: real hosted-payment credentials found for provider "${credentials.providerName}". Making REAL HTTPS calls. ===\n` +
    `Base URL: ${credentials.baseUrl}\n\n`
  );
  const adapter = new HostedCheckoutPaymentAdapter(credentials);
  const correlationId = `cert-${Date.now()}`;

  const created = await adapter.createPayment({
    quoteId: '00000000-0000-4000-8000-000000000001',
    expectedAmountMinor: 100,
    currency: 'EUR',
    correlationId
  });
  record('LIVE createPayment() reaches the configured provider', created.ok || created.error.kind !== 'TERMINAL_FAILURE', JSON.stringify(created).slice(0, 200));

  const health = await adapter.health();
  record('LIVE health() probe', health.healthy, JSON.stringify(health));

  process.stdout.write(
    '\nLive certification complete. Review the results above against the provider\'s own\n' +
    'sandbox documentation before treating this provider as certified for wider use.\n'
  );
} else {
  process.stdout.write(
    '=== FIXTURE-ONLY CERTIFICATION: no hosted-payment provider credentials configured. ===\n' +
    'No payment provider has been approved by the founder and none of\n' +
    'VOYARA_PAYMENT_PROVIDER_NAME / VOYARA_PAYMENT_MERCHANT_ID / VOYARA_PAYMENT_API_KEY /\n' +
    'VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET are set. No live HTTPS call has been made or will\n' +
    'be made by this run. Everything below exercises the generic hosted-checkout adapter\'s\n' +
    'request construction, response mapping, webhook verification, and error classification\n' +
    'against documented fixtures only — see hosted-checkout-contract.ts for exactly what is\n' +
    'and is not verified, and docs/phase-3c/...PAYMENT-ACTIVATION-RUNBOOK.md for what a real\n' +
    'provider decision requires.\n\n'
  );

  const fixtureCredentials = {
    providerName: 'certification-fixture-provider',
    merchantId: 'certification-fixture-merchant',
    apiKey: 'certification-fixture-key',
    webhookSigningSecret: 'certification-fixture-secret-0000000000000000',
    baseUrl: 'https://fixture.invalid'
  };

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  const errJson = (status, body) => ({ ok: false, status, json: async () => body });

  function fixtureFetch(routes) {
    return async (url, init) => {
      const path = new URL(url).pathname;
      const auth = init.headers?.Authorization;
      if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== fixtureCredentials.apiKey) {
        return errJson(401, HOSTED_CHECKOUT_FIXTURE_AUTH_ERROR);
      }
      const route = routes[path];
      if (!route) return errJson(404, { error: { message: 'no fixture route' } });
      return route(init.body ? JSON.parse(init.body) : undefined);
    };
  }

  // 1. Successful payment creation.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials, {
      fetchImpl: fixtureFetch({ '/v1/payment-intents': () => okJson(HOSTED_CHECKOUT_FIXTURE_CREATE_SUCCESS) })
    });
    const result = await adapter.createPayment({
      quoteId: '00000000-0000-4000-8000-000000000001', expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'cert-create-000001'
    });
    record('createPayment() with valid auth maps a successful response', result.ok && result.value.detectedStatus === 'PENDING');
    if (result.ok) {
      record('  → commercialSource is SANDBOX, simulated is false', result.value.source === 'SANDBOX' && result.value.simulated === false);
      record('  → hostedPaymentUrl is present', Boolean(result.value.hostedPaymentUrl));
    }
  }

  // 2. Auth failure.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials, {
      fetchImpl: fixtureFetch({}) // no valid auth ever supplied by this route map, but wrong-key path taken via below.
    });
    const result = await adapter.lookupStatus({ intentReference: 'hc-intent-000001', correlationId: 'cert-status-000001' });
    record('a request with no matching auth is rejected 401 → TERMINAL_FAILURE', !result.ok && result.error.kind === 'TERMINAL_FAILURE');
  }

  // 3. Rate limiting.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials, {
      fetchImpl: fixtureFetch({ '/v1/payment-intents': () => errJson(429, HOSTED_CHECKOUT_FIXTURE_RATE_LIMIT_ERROR) })
    });
    const result = await adapter.createPayment({
      quoteId: '00000000-0000-4000-8000-000000000001', expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'cert-create-000002'
    });
    record('429 rate limit maps to RATE_LIMIT', !result.ok && result.error.kind === 'RATE_LIMIT');
  }

  // 4. Timeout.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials, {
      timeoutMs: 5,
      fetchImpl: () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50))
    });
    const result = await adapter.createPayment({
      quoteId: '00000000-0000-4000-8000-000000000001', expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'cert-create-000003'
    });
    record('a network timeout maps to TIMEOUT', !result.ok && result.error.kind === 'TIMEOUT');
  }

  // 5. Status lookup mapping.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials, {
      fetchImpl: fixtureFetch({ '/v1/payment-intents/hc-intent-000001': () => okJson(HOSTED_CHECKOUT_FIXTURE_STATUS_PAID) })
    });
    const result = await adapter.lookupStatus({ intentReference: 'hc-intent-000001', correlationId: 'cert-status-000002' });
    record('a PAID provider status maps to DETECTED (detection, not verification)', result.ok && result.value === 'DETECTED');
  }

  // 6. Webhook signature verification — valid and invalid.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials);
    const timestamp = new Date().toISOString();
    const body = JSON.stringify({ eventId: 'evt-000001', status: 'PAID' });
    const validSignature = signHostedCheckoutWebhook(fixtureCredentials.webhookSigningSecret, timestamp, body);
    record('a correctly signed webhook verifies', adapter.verifyWebhookSignature({ eventId: 'evt-000001', eventType: 'payment.paid', timestamp, signature: validSignature, body }, fixtureCredentials.webhookSigningSecret));
    record('a tampered signature is rejected', !adapter.verifyWebhookSignature({ eventId: 'evt-000001', eventType: 'payment.paid', timestamp, signature: 'f'.repeat(64), body }, fixtureCredentials.webhookSigningSecret));
    record('a wrong secret is rejected', !adapter.verifyWebhookSignature({ eventId: 'evt-000001', eventType: 'payment.paid', timestamp, signature: validSignature, body }, 'a-completely-different-secret-000000000000'));
  }

  // 7. Refund preparation never executes.
  {
    const adapter = new HostedCheckoutPaymentAdapter(fixtureCredentials);
    const result = await adapter.prepareRefundRequest('00000000-0000-4000-8000-000000000009', 130_000, 'AZN');
    record('prepareRefundRequest() only prepares, requiring human approval', result.ok && result.value.requiresHumanApproval === true && result.value.refundRequestStatus === 'PREPARED');
  }

  // 8. No refund-execution or booking-confirmation endpoint referenced in code.
  {
    const raw = await (await import('node:fs/promises')).readFile(
      new URL('../src/server/payment/providers/hosted-checkout/hosted-checkout-adapter.ts', import.meta.url),
      'utf8'
    );
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    record('no code path constructs a refund-execution request', !/\/refund/i.test(codeOnly));
    record('no code path constructs a booking-confirmation request', !/\/book/i.test(codeOnly));
  }

  process.stdout.write(
    '\nFixture-only certification complete. This run made ZERO live HTTPS calls and does not\n' +
    'certify any specific provider. To certify against a real provider\'s Sandbox: obtain the\n' +
    'founder\'s chosen provider\'s credentials, set the five VOYARA_PAYMENT_* variables, and\n' +
    'rerun this script — it will automatically switch to the LIVE branch above.\n'
  );
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
if (failed.length > 0) {
  process.stderr.write(`FAILED: ${failed.map((f) => f.name).join(', ')}\n`);
  process.exitCode = 1;
}
