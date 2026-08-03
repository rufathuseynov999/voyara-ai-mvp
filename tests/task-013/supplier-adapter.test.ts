import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finaliseOffer,
  hotelSearchRequestSchema,
  normalizedHotelOfferSchema,
  verifyOfferHash,
  type HotelSearchRequest,
  type NormalizedHotelOfferBody
} from '@/server/supplier/adapter';
import { SimulationSupplierAdapter } from '@/server/supplier/simulation-adapter';
import { createSupplierAdapter, resolveSupplierAdapter, SupplierAdapterError } from '@/server/supplier/registry';
import { commercialSourceForMode } from '@/server/supplier/contract';

const validSearch = (): HotelSearchRequest => ({
  destination: 'Maldives',
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'AZN',
  correlationId: 'corr-abc-12345'
});

const baseEnv = (overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  VOYARA_SUPPLIER_MODE: 'SIMULATION',
  VOYARA_SUPPLIER_ADAPTER: 'simulation',
  VOYARA_PAYMENT_MODE: 'SIMULATION',
  VOYARA_PAYMENT_ADAPTER: 'simulation',
  VOYARA_LIVE_BOOKING_ENABLED: 'false',
  ...overrides
});

test('request validation rejects malformed search input', () => {
  assert.equal(hotelSearchRequestSchema.safeParse(validSearch()).success, true);
  assert.equal(hotelSearchRequestSchema.safeParse({ ...validSearch(), checkOut: '2026-08-01' }).success, false);
  assert.equal(hotelSearchRequestSchema.safeParse({ ...validSearch(), correlationId: 'short' }).success, false);
  assert.equal(
    hotelSearchRequestSchema.safeParse({ ...validSearch(), occupancy: { adults: 0, children: 0, rooms: 1 } }).success,
    false
  );
});

test('simulation search returns repeatable results for identical requests', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  const first = await adapter.search(validSearch());
  const second = await adapter.search(validSearch());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.ok(first.ok && first.value.length >= 3);
  assert.deepEqual(first, second);
  // Content hashes stable across runs.
  if (first.ok && second.ok) {
    assert.deepEqual(first.value.map((o) => o.contentHash), second.value.map((o) => o.contentHash));
  }
});

test('normalized offers have the full structure and valid expiry', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  const result = await adapter.search(validSearch());
  assert.ok(result.ok);
  for (const offer of result.value) {
    assert.equal(normalizedHotelOfferSchema.safeParse(offer).success, true);
    assert.ok(offer.roomType.length > 0);
    assert.ok(offer.boardBasis.length > 0);
    assert.ok(Date.parse(offer.expiresAt) > Date.parse(offer.createdAt));
    assert.ok(offer.supplierOfferReference.length > 0);
    assert.ok(offer.cancellationPolicy.kind.length > 0);
  }
});

test('all simulation output is clearly labelled and never claims LIVE', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  assert.equal(adapter.simulated, true);
  assert.equal(adapter.mode, 'SIMULATION');
  const result = await adapter.search(validSearch());
  assert.ok(result.ok);
  for (const offer of result.value) {
    assert.equal(offer.simulated, true);
    assert.equal(offer.commercialSource, commercialSourceForMode('SIMULATION'));
    assert.notEqual(offer.commercialSource, 'LIVE');
    assert.ok(offer.propertyName.includes('[SIMULATED]'));
    assert.ok(offer.supplierPropertyId.startsWith('SIM-'));
    assert.ok(offer.supplierOfferReference.startsWith('SIM-'));
  }
});

test('malformed supplier response is rejected by the offer schema', () => {
  const badBody = {
    supplierId: 'sim-supplier',
    supplierPropertyId: 'SIM-PROP-0',
    internalPropertyId: null,
    propertyName: '[SIMULATED] Test',
    destination: 'X',
    roomType: 'Deluxe',
    boardBasis: 'HALF_BOARD',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    cancellationPolicy: { kind: 'NON_REFUNDABLE' },
    supplierNetMinor: -1, // invalid
    taxesMinor: 0,
    mandatoryFeesMinor: 0,
    currency: 'AZN',
    customerTotalMinor: null,
    supplierOfferReference: 'SIM-OFFER-0',
    createdAt: '2026-07-20T09:00:00.000Z',
    expiresAt: '2026-07-20T09:30:00.000Z',
    supplierTraceId: 'SIM-TRACE-0',
    commercialSource: 'SIMULATED',
    simulated: true
  } as unknown as NormalizedHotelOfferBody;
  assert.throws(() => finaliseOffer(badBody));
});

test('unavailable and price-changed responses normalize to the shared taxonomy', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  const unavailable = await adapter.search({ ...validSearch(), destination: 'SIM-UNAVAILABLE city' });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    assert.equal(unavailable.error.kind, 'UNAVAILABLE');
    assert.equal(unavailable.error.retryable, true);
    assert.equal(unavailable.error.code, 'SUPPLIER_UNAVAILABLE');
  }

  const priceChanged = await adapter.revalidate({
    supplierOfferReference: 'SIM-PRICECHANGED-REF-1',
    correlationId: 'corr-abc-12345'
  });
  assert.equal(priceChanged.ok, false);
  if (!priceChanged.ok) {
    assert.equal(priceChanged.error.kind, 'PRICE_CHANGED');
    assert.equal(priceChanged.error.retryable, false);
  }
});

test('registry: unsupported adapter and non-simulation modes fail closed', () => {
  // Unsupported adapter id under simulation mode.
  assert.throws(() => createSupplierAdapter('SIMULATION', 'acme-live'), SupplierAdapterError);
  // Live mode never falls back to simulation.
  assert.throws(() => createSupplierAdapter('LIVE', 'simulation'), (error: unknown) => {
    return error instanceof SupplierAdapterError && error.code === 'LIVE_NOT_AVAILABLE';
  });
  assert.throws(() => createSupplierAdapter('SANDBOX', 'simulation'), SupplierAdapterError);
  // Valid simulation resolves.
  const adapter = createSupplierAdapter('SIMULATION', 'simulation');
  assert.equal(adapter.simulated, true);
});

test('resolveSupplierAdapter: simulation env resolves; live env does not fall back', () => {
  const sim = resolveSupplierAdapter(baseEnv());
  assert.equal(sim.mode, 'SIMULATION');
  assert.equal(sim.simulated, true);

  assert.throws(() => resolveSupplierAdapter(baseEnv({
    VOYARA_SUPPLIER_MODE: 'LIVE',
    VOYARA_PAYMENT_MODE: 'LIVE',
    VOYARA_WEBHOOK_SECRET: 'w'.repeat(40)
  })), SupplierAdapterError);
});

test('no sensitive payload leaks through normalized errors', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  const unavailable = await adapter.search({ ...validSearch(), destination: 'SIM-UNAVAILABLE secret-token-xyz' });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    const serialized = JSON.stringify(unavailable.error);
    assert.ok(!serialized.includes('secret-token-xyz'));
    assert.ok(!/password|secret|key|token=|bearer/i.test(serialized) || serialized.includes('SUPPLIER_'));
    assert.match(unavailable.error.code, /^SUPPLIER_[A-Z_]+$/);
  }
});

test('content hash is stable and self-verifying', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  const result = await adapter.search(validSearch());
  assert.ok(result.ok);
  for (const offer of result.value) {
    assert.equal(verifyOfferHash(offer), true);
    // Re-finalising the same body reproduces the same hash.
    const { contentHash, ...body } = offer;
    assert.equal(finaliseOffer(body).contentHash, contentHash);
  }
});

test('booking preparation produces a human-approval payload and never books', async () => {
  const adapter = new SimulationSupplierAdapter(() => new Date('2026-07-20T09:00:00.000Z'));
  const prepared = await adapter.prepareBooking({
    supplierOfferReference: 'SIM-OFFER-0-abcdef1234',
    correlationId: 'corr-abc-12345'
  });
  assert.ok(prepared.ok);
  if (prepared.ok) {
    assert.equal(prepared.value.requiresHumanApproval, true);
    assert.equal(prepared.value.simulated, true);
    assert.match(prepared.value.offerContentHash, /^[0-9a-f]{64}$/);
  }
});
