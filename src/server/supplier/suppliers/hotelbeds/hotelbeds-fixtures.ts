import type { HotelbedsCheckRateResponse, HotelbedsErrorResponse, HotelbedsSearchResponse } from './hotelbeds-contract';

/**
 * Phase 3C Part 2 — documented Hotelbeds sandbox fixtures.
 *
 * These are hand-built to match the wire shape described in
 * hotelbeds-contract.ts — not captured from a live sandbox (none is
 * reachable from this environment). They exist so the adapter's mapping,
 * error-classification and persistence logic can be exercised deterministically
 * in tests and in scripts/certify-hotelbeds-sandbox.mjs. A real sandbox
 * certification run (once the founder has real credentials) should replace
 * reliance on these with live responses — see the runbook.
 */

export const HOTELBEDS_FIXTURE_SEARCH_SUCCESS: HotelbedsSearchResponse = {
  hotels: {
    total: 1,
    hotels: [
      {
        code: 123456,
        name: 'Fixture Grand Hotel',
        categoryName: '5 STARS',
        destinationName: 'Baku',
        rooms: [
          {
            code: 'DBL.ST',
            name: 'DOUBLE STANDARD',
            rates: [
              {
                rateKey: '20260901|20260905|W|123456|DBL.ST|BB|RO~1~2~0||1~2~0-1-0~1~i2~i2~ES~ES-EN~N@~~N~NOR~',
                net: '345.60',
                sellingRate: '412.00',
                boardCode: 'BB',
                boardName: 'BED AND BREAKFAST',
                rateClass: 'NOR',
                rateType: 'BOOKABLE',
                cancellationPolicies: [{ amount: '0.00', from: '2026-08-25T23:59:00+03:00' }],
                rooms: 1
              }
            ]
          }
        ]
      }
    ]
  }
};

export const HOTELBEDS_FIXTURE_SEARCH_EMPTY: HotelbedsSearchResponse = {
  hotels: { total: 0, hotels: [] }
};

export const HOTELBEDS_FIXTURE_CHECKRATE_SAME_PRICE: HotelbedsCheckRateResponse = {
  hotel: HOTELBEDS_FIXTURE_SEARCH_SUCCESS.hotels.hotels[0]
};

export const HOTELBEDS_FIXTURE_CHECKRATE_PRICE_CHANGED: HotelbedsCheckRateResponse = {
  hotel: {
    ...HOTELBEDS_FIXTURE_SEARCH_SUCCESS.hotels.hotels[0],
    rooms: [
      {
        ...HOTELBEDS_FIXTURE_SEARCH_SUCCESS.hotels.hotels[0].rooms[0],
        rates: [
          {
            ...HOTELBEDS_FIXTURE_SEARCH_SUCCESS.hotels.hotels[0].rooms[0].rates[0],
            net: '378.90' // higher than the originally quoted 345.60
          }
        ]
      }
    ]
  }
};

export const HOTELBEDS_FIXTURE_AUTH_ERROR: HotelbedsErrorResponse = {
  error: { code: 'AUTHENTICATION-001', message: 'Invalid credentials' }
};

export const HOTELBEDS_FIXTURE_VALIDATION_ERROR: HotelbedsErrorResponse = {
  error: { code: 'VALIDATION-014', message: 'checkIn must be in the future' }
};

export const HOTELBEDS_FIXTURE_RATE_LIMIT_ERROR: HotelbedsErrorResponse = {
  error: { code: 'RATE-LIMIT-001', message: 'Too many requests' }
};
