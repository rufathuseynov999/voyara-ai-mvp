/**
 * Phase 3C Part 2 — Hotelbeds Booking API v3 wire format.
 *
 * IMPORTANT — honesty about what is and isn't verified:
 * This environment has no network access to developer.hotelbeds.com and no
 * live or sandbox Hotelbeds credentials exist anywhere in this project (see
 * the Part 2 checkpoint for the exact search performed). Everything in this
 * file is modeled on Hotelbeds' long-standing, publicly documented Booking
 * API v3 contract (the same shape has been stable for years and is widely
 * described in third-party integration writeups), but it has NOT been
 * exercised against a live endpoint and field-level names should be
 * confirmed against the founder's actual sandbox credentials/Postman
 * collection during certification (see docs/phase-3c-part2/...RUNBOOK.md).
 * What IS implemented with full confidence, independent of any live check:
 *   - the authentication scheme (hotelbeds-signature.ts) — stable, documented
 *   - HTTP-status-level error semantics (401/403/429/5xx/timeout)
 *   - every HAG/authority/persistence guarantee in hotelbeds-adapter.ts
 * The wire shapes below are the part a live certification run would correct
 * first, if anything needs correcting.
 */
import { z } from 'zod';

/* --------------------------------- Search --------------------------------- */

export const hotelbedsOccupancySchema = z.object({
  rooms: z.number().int().min(1),
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  paxes: z.array(z.object({ type: z.enum(['AD', 'CH']), age: z.number().int().min(0).max(17).optional() })).optional()
}).strict();

export const hotelbedsSearchRequestSchema = z.object({
  stay: z.object({ checkIn: z.string(), checkOut: z.string() }).strict(),
  occupancies: z.array(hotelbedsOccupancySchema).min(1),
  destination: z.object({ code: z.string() }).strict().optional(),
  hotels: z.object({ hotel: z.array(z.number().int()) }).strict().optional(),
  filter: z.object({ maxHotels: z.number().int().optional() }).strict().optional()
}).strict();
export type HotelbedsSearchRequest = z.infer<typeof hotelbedsSearchRequestSchema>;

export const hotelbedsCancellationPolicySchema = z.object({
  amount: z.string(),
  from: z.string()
}).strict();

export const hotelbedsRateSchema = z.object({
  rateKey: z.string(),
  net: z.string(),
  sellingRate: z.string().optional(),
  boardCode: z.string(),
  boardName: z.string(),
  rateClass: z.string().optional(),
  rateType: z.string().optional(),
  cancellationPolicies: z.array(hotelbedsCancellationPolicySchema).optional(),
  rooms: z.number().int().optional()
}).strict();
export type HotelbedsRate = z.infer<typeof hotelbedsRateSchema>;

export const hotelbedsRoomSchema = z.object({
  code: z.string(),
  name: z.string(),
  rates: z.array(hotelbedsRateSchema)
}).strict();

export const hotelbedsHotelSchema = z.object({
  code: z.number().int(),
  name: z.string(),
  categoryName: z.string().optional(),
  destinationName: z.string().optional(),
  rooms: z.array(hotelbedsRoomSchema)
}).strict();
export type HotelbedsHotel = z.infer<typeof hotelbedsHotelSchema>;

export const hotelbedsSearchResponseSchema = z.object({
  hotels: z.object({
    total: z.number().int().optional(),
    hotels: z.array(hotelbedsHotelSchema)
  }).strict()
}).strict();
export type HotelbedsSearchResponse = z.infer<typeof hotelbedsSearchResponseSchema>;

/* ------------------------------- Check rate -------------------------------- */

export const hotelbedsCheckRateRequestSchema = z.object({
  rooms: z.array(z.object({ rateKey: z.string() }).strict()).min(1)
}).strict();
export type HotelbedsCheckRateRequest = z.infer<typeof hotelbedsCheckRateRequestSchema>;

export const hotelbedsCheckRateResponseSchema = z.object({
  hotel: hotelbedsHotelSchema
}).strict();
export type HotelbedsCheckRateResponse = z.infer<typeof hotelbedsCheckRateResponseSchema>;

/* --------------------------------- Errors ---------------------------------- */

export const hotelbedsErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional()
  }).strict()
}).strict();
export type HotelbedsErrorResponse = z.infer<typeof hotelbedsErrorResponseSchema>;

/** Board-code mapping. Hotelbeds' board codes are a well-known fixed set;
 *  unmapped codes fall back to ROOM_ONLY rather than throwing, so an
 *  unexpected code degrades the offer's accuracy without breaking the whole
 *  search — flagged via the adapter's audit log, not silently swallowed. */
export const HOTELBEDS_BOARD_CODE_MAP: Record<string, 'ROOM_ONLY' | 'BED_AND_BREAKFAST' | 'HALF_BOARD' | 'FULL_BOARD' | 'ALL_INCLUSIVE'> = {
  RO: 'ROOM_ONLY',
  SC: 'ROOM_ONLY',
  BB: 'BED_AND_BREAKFAST',
  CB: 'BED_AND_BREAKFAST',
  HB: 'HALF_BOARD',
  MB: 'HALF_BOARD',
  FB: 'FULL_BOARD',
  AI: 'ALL_INCLUSIVE',
  UI: 'ALL_INCLUSIVE'
};
