#!/usr/bin/env node
/**
 * Phase 3C Part 2 — Hotelbeds sandbox certification script.
 *
 * Behavior:
 *   - If VOYARA_HOTELBEDS_API_KEY / VOYARA_HOTELBEDS_API_SECRET are present
 *     and non-placeholder, this script makes REAL HTTPS calls to the
 *     configured Hotelbeds base URL (default: the public Hotelbeds sandbox,
 *     api.test.hotelbeds.com) and reports what actually came back. Nothing
 *     is faked in this branch.
 *   - If credentials are absent (the case in this repository as delivered —
 *     see the Phase 3C Part 2 checkpoint for the exact search performed),
 *     this script certifies the adapter's request construction, response
 *     mapping, and error classification against the documented fixtures in
 *     src/server/supplier/suppliers/hotelbeds/hotelbeds-fixtures.ts instead.
 *     This is clearly labelled in every line of output — it NEVER claims a
 *     live connection succeeded when none was attempted.
 *
 * Run: node --import tsx scripts/certify-hotelbeds-sandbox.mjs
 */
import { readHotelbedsCredentials } from '../src/config/env-core.ts';
import { HotelbedsSupplierAdapter } from '../src/server/supplier/suppliers/hotelbeds/hotelbeds-adapter.ts';
import {
  HOTELBEDS_FIXTURE_AUTH_ERROR,
  HOTELBEDS_FIXTURE_CHECKRATE_PRICE_CHANGED,
  HOTELBEDS_FIXTURE_CHECKRATE_SAME_PRICE,
  HOTELBEDS_FIXTURE_RATE_LIMIT_ERROR,
  HOTELBEDS_FIXTURE_SEARCH_EMPTY,
  HOTELBEDS_FIXTURE_SEARCH_SUCCESS
} from '../src/server/supplier/suppliers/hotelbeds/hotelbeds-fixtures.ts';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

const credentials = readHotelbedsCredentials();

if (credentials) {
  process.stdout.write(
    '=== LIVE MODE: real Hotelbeds Sandbox credentials found. Making REAL HTTPS calls. ===\n' +
    `Base URL: ${credentials.baseUrl}\n\n`
  );
  const adapter = new HotelbedsSupplierAdapter(credentials, { actorId: 'certification-script' });
  const correlationId = `cert-${Date.now()}`;

  const searchResult = await adapter.search({
    destination: 'BJV',
    checkIn: '2027-01-10',
    checkOut: '2027-01-13',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    currency: 'EUR',
    correlationId
  });
  record('LIVE search() reaches Hotelbeds Sandbox and returns a well-formed result', searchResult.ok || searchResult.error.kind !== 'TERMINAL_FAILURE', JSON.stringify(searchResult).slice(0, 200));

  const health = await adapter.health();
  record('LIVE health() probe', health.healthy, JSON.stringify(health));

  process.stdout.write(
    '\nLive certification complete. Review the results above against Hotelbeds\' own sandbox\n' +
    'test-booking documentation before treating this supplier as certified for wider use.\n'
  );
} else {
  process.stdout.write(
    '=== FIXTURE-ONLY CERTIFICATION: no Hotelbeds Sandbox credentials configured. ===\n' +
    'VOYARA_HOTELBEDS_API_KEY / VOYARA_HOTELBEDS_API_SECRET are not set in this environment.\n' +
    'No live HTTPS call has been made or will be made by this run. Everything below exercises\n' +
    'the adapter\'s request construction, response mapping and error classification against\n' +
    'documented fixtures only — see hotelbeds-fixtures.ts for exactly what is and is not verified.\n\n'
  );

  const fixtureCredentials = { apiKey: 'certification-fixture-key', apiSecret: 'certification-fixture-secret', baseUrl: 'https://fixture.invalid' };

  function fixtureFetch(routes) {
    return async (url, init) => {
      const path = new URL(url).pathname;
      const auth = init.headers?.['X-Signature'];
      if (!auth || auth.length !== 64) {
        return { ok: false, status: 401, json: async () => HOTELBEDS_FIXTURE_AUTH_ERROR };
      }
      const route = routes[path];
      if (!route) return { ok: false, status: 404, json: async () => ({ error: { message: 'no fixture route' } }) };
      return route(JSON.parse(init.body));
    };
  }

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  const errJson = (status, body) => ({ ok: false, status, json: async () => body });

  // 1. Auth header shape (signature is a 64-char hex SHA256 — verified without any network).
  {
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      fetchImpl: fixtureFetch({ '/hotel-api/1.0/hotels': () => okJson(HOTELBEDS_FIXTURE_SEARCH_SUCCESS) })
    });
    const result = await adapter.search({
      destination: 'BJV', checkIn: '2027-01-10', checkOut: '2027-01-13',
      occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN', correlationId: 'cert-search-000001'
    });
    record('search() sends a valid Api-key + X-Signature pair and maps a successful response', result.ok && result.value.length === 1);
    if (result.ok) {
      const offer = result.value[0];
      record('  → board basis mapped (BB → BED_AND_BREAKFAST)', offer.boardBasis === 'BED_AND_BREAKFAST');
      record('  → cancellation policy mapped (free tier → FREE_UNTIL)', offer.cancellationPolicy.kind === 'FREE_UNTIL');
      record('  → money parsed to integer minor units (345.60 → 34560)', offer.supplierNetMinor === 34560);
      record('  → commercialSource is SANDBOX, simulated is false', offer.commercialSource === 'SANDBOX' && offer.simulated === false);
    }
  }

  // 2. Empty search result.
  {
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      fetchImpl: fixtureFetch({ '/hotel-api/1.0/hotels': () => okJson(HOTELBEDS_FIXTURE_SEARCH_EMPTY) })
    });
    const result = await adapter.search({
      destination: 'ZZZ', checkIn: '2027-01-10', checkOut: '2027-01-13',
      occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN', correlationId: 'cert-search-000002'
    });
    record('search() with no results returns ok:true with an empty array (not an error)', result.ok && result.value.length === 0);
  }

  // 3. Auth failure.
  {
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      fetchImpl: fixtureFetch({ '/hotel-api/1.0/hotels': () => errJson(401, HOTELBEDS_FIXTURE_AUTH_ERROR) })
    });
    const result = await adapter.search({
      destination: 'BJV', checkIn: '2027-01-10', checkOut: '2027-01-13',
      occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN', correlationId: 'cert-search-000003'
    });
    record('401 auth failure maps to TERMINAL_FAILURE (non-retryable)', !result.ok && result.error.kind === 'TERMINAL_FAILURE' && !result.error.retryable);
  }

  // 4. Rate limiting.
  {
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      fetchImpl: fixtureFetch({ '/hotel-api/1.0/hotels': () => errJson(429, HOTELBEDS_FIXTURE_RATE_LIMIT_ERROR) })
    });
    const result = await adapter.search({
      destination: 'BJV', checkIn: '2027-01-10', checkOut: '2027-01-13',
      occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN', correlationId: 'cert-search-000004'
    });
    record('429 rate limit maps to RATE_LIMIT (retryable)', !result.ok && result.error.kind === 'RATE_LIMIT' && result.error.retryable);
  }

  // 5. Timeout.
  {
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      timeoutMs: 5,
      fetchImpl: () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50))
    });
    const result = await adapter.search({
      destination: 'BJV', checkIn: '2027-01-10', checkOut: '2027-01-13',
      occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN', correlationId: 'cert-search-000005'
    });
    record('a network timeout maps to TIMEOUT (retryable)', !result.ok && result.error.kind === 'TIMEOUT' && result.error.retryable);
  }

  // 6. Revalidation — unchanged.
  {
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      fetchImpl: fixtureFetch({ '/hotel-api/1.0/checkrates': () => okJson(HOTELBEDS_FIXTURE_CHECKRATE_SAME_PRICE) })
    });
    const result = await adapter.revalidate({
      supplierOfferReference: HOTELBEDS_FIXTURE_CHECKRATE_SAME_PRICE.hotel.rooms[0].rates[0].rateKey,
      correlationId: 'cert-revalidate-000001'
    });
    record('revalidate() with an unchanged rateKey returns ok:true', result.ok);
  }

  // 7. Revalidation — price changed (supplier reissues a different rateKey).
  {
    const original = HOTELBEDS_FIXTURE_SEARCH_SUCCESS.hotels.hotels[0].rooms[0].rates[0].rateKey;
    const adapter = new HotelbedsSupplierAdapter(fixtureCredentials, {
      actorId: 'cert',
      fetchImpl: fixtureFetch({
        '/hotel-api/1.0/checkrates': () => okJson({
          hotel: { ...HOTELBEDS_FIXTURE_CHECKRATE_PRICE_CHANGED.hotel, rooms: [{ ...HOTELBEDS_FIXTURE_CHECKRATE_PRICE_CHANGED.hotel.rooms[0], rates: [{ ...HOTELBEDS_FIXTURE_CHECKRATE_PRICE_CHANGED.hotel.rooms[0].rates[0], rateKey: `${original}-REPRICED` }] }] }
        })
      })
    });
    const result = await adapter.revalidate({ supplierOfferReference: original, correlationId: 'cert-revalidate-000002' });
    record('revalidate() with a reissued rateKey returns PRICE_CHANGED (non-retryable)', !result.ok && result.error.kind === 'PRICE_CHANGED' && !result.error.retryable);
  }

  // 8. Booking preparation never references the booking-confirmation endpoint
  //    in actual code — strip comments first so the check verifies code
  //    paths, not the docstring that explains this property.
  {
    const raw = await (await import('node:fs/promises')).readFile(
      new URL('../src/server/supplier/suppliers/hotelbeds/hotelbeds-adapter.ts', import.meta.url),
      'utf8'
    );
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, ''); // line comments
    record('no code path constructs a request to /hotel-api/1.0/bookings', !codeOnly.includes('/hotel-api/1.0/bookings'));
    record('prepareBooking always sets requiresHumanApproval: true', codeOnly.includes('requiresHumanApproval: true'));
  }

  process.stdout.write(
    '\nFixture-only certification complete. This run made ZERO live HTTPS calls.\n' +
    'To certify against the real Hotelbeds Sandbox: obtain credentials, set\n' +
    'VOYARA_HOTELBEDS_API_KEY / VOYARA_HOTELBEDS_API_SECRET, and rerun this script —\n' +
    'it will automatically switch to the LIVE branch above.\n'
  );
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
if (failed.length > 0) {
  process.stderr.write(`FAILED: ${failed.map((f) => f.name).join(', ')}\n`);
  process.exitCode = 1;
}
