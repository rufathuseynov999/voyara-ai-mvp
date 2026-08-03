/**
 * Phase 4C defect fix — `account_id` columns across this schema are typed
 * `uuid` (e.g. `contacts.account_id`), but two call sites were passing a
 * non-UUID string (`'voyara-website'`, and separately a WhatsApp phone
 * number id) as `accountId`. Hermetic tests never caught this because the
 * in-memory stores don't enforce column types — it only surfaced against a
 * real PostgreSQL database, exactly the kind of gap real-sandbox
 * verification exists to catch.
 *
 * VOYARA is a single-business system (not multi-tenant — see every other
 * `account_id` usage in this project, e.g. `SYSTEM_ACTOR_ID` in
 * registry.ts), so a single well-known constant UUID is the correct fix,
 * not a per-channel identifier. Both the website chat route and the
 * WhatsApp webhook route now use this same constant.
 */
export const VOYARA_BUSINESS_ACCOUNT_ID = '00000000-0000-4000-9000-000000000001';

/**
 * Phase 4D defect fix — `call_events.actor_id` (and every other
 * `*_events.actor_id` column in this schema) is typed `uuid`, but the
 * voice layer's internal `audit()` helper and two webhook-processing call
 * sites were passing the literal string `'system'` for automated,
 * system-originated events. Hermetic tests never caught this because the
 * in-memory `CallStore` doesn't enforce column types — exactly the same
 * class of gap the `VOYARA_BUSINESS_ACCOUNT_ID` fix above addresses, only
 * surfaced this time by the real-sandbox voice test suite.
 *
 * One stable, well-known, reserved UUID — never a customer, founder, or
 * staff id, and never a freshly generated `randomUUID()` per event (that
 * would make it impossible to query "which events were system-originated"
 * as a group). Every automated audit-event write across the voice layer
 * (and any future subsystem needing the same thing) should use this same
 * constant, not invent its own.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000000';
