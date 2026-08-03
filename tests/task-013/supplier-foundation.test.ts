import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readIntegrationConfig } from '@/config/env-core';
import {
  commercialSourceForMode,
  integrationModes,
  isAuthoritativeMode,
  isAuthoritativeSource,
  isMateriallyEqual,
  isSimulationMode,
  materialCommercialFieldsSchema,
  materialFieldDifferences,
  normalizeSupplierError,
  supplierErrorKinds,
  type MaterialCommercialFields
} from '@/server/supplier/contract';

const baseEnv = (overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  VOYARA_SUPPLIER_MODE: 'SIMULATION',
  VOYARA_SUPPLIER_ADAPTER: 'simulation',
  VOYARA_PAYMENT_MODE: 'SIMULATION',
  VOYARA_PAYMENT_ADAPTER: 'simulation',
  VOYARA_LIVE_BOOKING_ENABLED: 'false',
  ...overrides
});

const validOffer = (): MaterialCommercialFields => ({
  supplierNetMinor: 800_000,
  taxesAndFeesMinor: 120_000,
  customerTotalMinor: 1_040_000,
  currency: 'AZN',
  roomType: 'Overwater villa',
  boardBasis: 'HALF_BOARD',
  cancellationPolicy: { kind: 'FREE_UNTIL', freeUntil: '2026-08-01' },
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  supplierOfferReference: 'OFFER-XYZ-001',
  offerExpiry: '2026-07-25T12:00:00.000Z'
});

test('valid integration modes parse; invalid modes fail closed', () => {
  for (const mode of integrationModes) {
    const config = readIntegrationConfig(baseEnv({ VOYARA_SUPPLIER_MODE: mode, VOYARA_PAYMENT_MODE: mode,
      ...(mode === 'LIVE'
        ? { VOYARA_WEBHOOK_SECRET: 'x'.repeat(32) }
        : {}) }));
    assert.equal(config.supplierMode, mode);
    assert.equal(config.paymentMode, mode);
  }
  assert.throws(() => readIntegrationConfig(baseEnv({ VOYARA_SUPPLIER_MODE: 'PRODUCTION' })));
  assert.throws(() => readIntegrationConfig(baseEnv({ VOYARA_PAYMENT_MODE: 'live' })));
});

test('live booking is disabled by default and cannot enable without full LIVE + secret', () => {
  const config = readIntegrationConfig(baseEnv());
  assert.equal(config.liveBookingEnabled, false);

  // Flag set true but modes are simulation → fails closed.
  assert.throws(() => readIntegrationConfig(baseEnv({ VOYARA_LIVE_BOOKING_ENABLED: 'true' })));

  // Both modes LIVE but no webhook secret → fails closed.
  assert.throws(() => readIntegrationConfig(baseEnv({
    VOYARA_SUPPLIER_MODE: 'LIVE',
    VOYARA_PAYMENT_MODE: 'LIVE',
    VOYARA_LIVE_BOOKING_ENABLED: 'true'
  })));

  // Fully LIVE with secret → allowed.
  const live = readIntegrationConfig(baseEnv({
    VOYARA_SUPPLIER_MODE: 'LIVE',
    VOYARA_PAYMENT_MODE: 'LIVE',
    VOYARA_LIVE_BOOKING_ENABLED: 'true',
    VOYARA_WEBHOOK_SECRET: 's'.repeat(48)
  }));
  assert.equal(live.liveBookingEnabled, true);

  // Only the exact string 'true' enables the flag.
  const typo = readIntegrationConfig(baseEnv({ VOYARA_LIVE_BOOKING_ENABLED: 'TRUE' }));
  assert.equal(typo.liveBookingEnabled, false);
});

test('simulation and sandbox output is non-authoritative and correctly labelled', () => {
  assert.equal(isSimulationMode('SIMULATION'), true);
  assert.equal(isAuthoritativeMode('SIMULATION'), false);
  assert.equal(isAuthoritativeMode('SANDBOX'), false);
  assert.equal(isAuthoritativeMode('LIVE'), true);

  assert.equal(commercialSourceForMode('SIMULATION'), 'SIMULATED');
  assert.equal(commercialSourceForMode('SANDBOX'), 'SANDBOX');
  assert.equal(commercialSourceForMode('LIVE'), 'LIVE');

  assert.equal(isAuthoritativeSource('SIMULATED'), false);
  assert.equal(isAuthoritativeSource('SANDBOX'), false);
  assert.equal(isAuthoritativeSource('MANUAL'), false);
  assert.equal(isAuthoritativeSource('LIVE'), true);
});

test('material-field comparison detects every material change and ignores nothing', () => {
  const previous = validOffer();
  assert.equal(isMateriallyEqual(previous, validOffer()), true);
  assert.deepEqual(materialFieldDifferences(previous, validOffer()), []);

  const priceChanged = { ...validOffer(), customerTotalMinor: 1_050_000 };
  assert.deepEqual(materialFieldDifferences(previous, priceChanged), ['customerTotalMinor']);

  const policyChanged = { ...validOffer(), cancellationPolicy: { kind: 'NON_REFUNDABLE' as const } };
  assert.deepEqual(materialFieldDifferences(previous, policyChanged), ['cancellationPolicy']);

  const occupancyChanged = { ...validOffer(), occupancy: { adults: 3, children: 0, rooms: 1 } };
  assert.deepEqual(materialFieldDifferences(previous, occupancyChanged), ['occupancy']);

  // Schema rejects an inverted date range (fail closed on invalid offers).
  const inverted = { ...validOffer(), checkIn: '2026-08-19', checkOut: '2026-08-12' };
  assert.equal(materialCommercialFieldsSchema.safeParse(inverted).success, false);
});

test('supplier-error normalization is total and unknown input fails closed', () => {
  for (const kind of supplierErrorKinds) {
    const normalized = normalizeSupplierError(kind);
    assert.equal(normalized.kind, kind);
    assert.equal(normalized.code, `SUPPLIER_${kind}`);
  }
  const retryable = normalizeSupplierError('TIMEOUT');
  assert.equal(retryable.retryable, true);
  const priceChanged = normalizeSupplierError('PRICE_CHANGED');
  assert.equal(priceChanged.retryable, false);

  // Unknown → terminal, non-retryable; no leaked payload in the code.
  const unknown = normalizeSupplierError({ providerMessage: 'secret internal detail' });
  assert.equal(unknown.kind, 'TERMINAL_FAILURE');
  assert.equal(unknown.retryable, false);
  assert.equal(unknown.code, 'SUPPLIER_TERMINAL_FAILURE');
  assert.ok(!unknown.code.includes('secret'));
});

test('no integration secret is exposed in .env.example or via a public prefix', async () => {
  const example = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  // The webhook secret placeholder must be present but only as a placeholder,
  // never a real-looking value, and never under a NEXT_PUBLIC_ prefix.
  assert.ok(example.includes('VOYARA_WEBHOOK_SECRET='));
  assert.ok(/VOYARA_WEBHOOK_SECRET=replace_with/.test(example));
  assert.ok(!/NEXT_PUBLIC_[A-Z_]*(WEBHOOK|SECRET)/.test(example));
  assert.ok(!/NEXT_PUBLIC_VOYARA_(SUPPLIER|PAYMENT)_ADAPTER/.test(example));
  // Live booking must be shipped disabled in the example.
  assert.ok(/VOYARA_LIVE_BOOKING_ENABLED=false/.test(example));

  // The config reader must not surface the secret to a caller that only asked
  // for modes (it lives on a dedicated field the caller must opt into reading).
  const config = readIntegrationConfig(baseEnv());
  assert.equal(config.webhookSecret, null);
});
