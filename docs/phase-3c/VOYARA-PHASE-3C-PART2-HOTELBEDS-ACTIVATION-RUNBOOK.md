# VOYARA AI — Phase 3C Part 2 Runbook: Hotelbeds Controlled Supplier Activation

Scope: exactly one hotel supplier (Hotelbeds), SANDBOX only. **No live supplier connection, no live payment, no autonomous booking confirmation is activated by this phase or this document.**

---

## 1. What was actually done — and what was not

**Done, and tested (28/28 focused tests + 13/13 fixture certification, all passing):** a complete, production-ready `HotelbedsSupplierAdapter` implementing the same provider-neutral `SupplierAdapter` interface the simulation adapter already implements — authentication header construction, search, availability, revalidation, human-review-only booking preparation, normalized error handling, sanitized request/response audit persistence, and a registry that fails closed (never falls back to simulation, never fabricates success) when credentials are absent or LIVE is requested.

**Not done, and explicitly out of scope:** **no real HTTPS call has ever been made to Hotelbeds from this environment.** There is no network path from this sandbox to `api.test.hotelbeds.com` (or any Hotelbeds domain), and — confirmed by an explicit search of environment variables, uploaded files, and the founder's own documents — **no Hotelbeds credentials of any kind exist anywhere in this project.** Every response the adapter has ever processed came from the documented fixtures in `hotelbeds-fixtures.ts`, built from public API documentation, not captured from a live sandbox. Field-level wire-format details (exact JSON key names, exact error-code strings) are the part most likely to need correction once real credentials allow a live certification run — see §4.

---

## 2. Founder account and application steps (external, cannot be completed from this environment)

1. Apply for a Hotelbeds Sandbox/test account at `developer.hotelbeds.com` (or through Hotelbeds' partner/business-development channel — API self-service enrollment availability varies by region and business type; a CIS/Azerbaijan-based agency may need to go through a partner manager rather than pure self-service signup).
2. Complete whatever business verification Hotelbeds requires (company registration, expected volume, target markets). This is a commercial/compliance step with no code component.
3. Once approved, Hotelbeds issues a **sandbox API key and secret** (test environment credentials, separate from any eventual production/LIVE credentials) and sandbox documentation/Postman collection specific to your account tier.
4. Obtain Hotelbeds' current Booking API v3 reference documentation (or whatever version they provision your account against) and their sandbox test-booking guide — these describe the exact request/response field names, which should be diffed against `hotelbeds-contract.ts` during certification (§4).

## 3. Required environment variables

| Variable | Where | Notes |
|---|---|---|
| `VOYARA_HOTELBEDS_API_KEY` | Preview + Production (SANDBOX only for now — see §5) | The sandbox API key issued in §2. Never share the format with `sb_secret_`/`sb_publishable_` prefixes — those are Supabase's, unrelated. |
| `VOYARA_HOTELBEDS_API_SECRET` | Preview + Production | The sandbox secret. Server-only; never expose with a `NEXT_PUBLIC_` prefix — `readHotelbedsCredentials()` does not read a public variant and nothing in the codebase does either. |
| `VOYARA_HOTELBEDS_BASE_URL` | Optional | Defaults to `https://api.test.hotelbeds.com` (Hotelbeds' public sandbox host) if unset. Only override if Hotelbeds provisions a different sandbox host for your account. |
| `VOYARA_SUPPLIER_MODE` | Existing (Phase 3A) | Must be set to `SANDBOX` to activate Hotelbeds at all. Remains `SIMULATION` by default in every template shipped so far — this runbook does not change any `.env.*.example` default. |
| `VOYARA_SUPPLIER_ADAPTER` | Existing (Phase 3A) | Must be set to `hotelbeds` when `VOYARA_SUPPLIER_MODE=SANDBOX`. Any other adapter id in SANDBOX mode is rejected (`UNSUPPORTED_ADAPTER`). |

Both Hotelbeds variables fail closed if missing (`CREDENTIALS_MISSING`) and are rejected if they contain placeholder-shaped text (the same `containsPlaceholder()` detector hardened in Phase 3C Part 1 — "replace_me", "your-key-here", "0123456789", etc.).

## 4. Supplier certification steps (do this before any wider use)

1. Set the two required environment variables locally (never commit them — they are ordinary secrets, not covered by any `.env.*.example` template since Hotelbeds activation is explicitly not part of the standard Preview/Production template in Phase 3C Part 1).
2. Run:
   ```bash
   npm run certify:hotelbeds
   ```
   With real credentials present, this script **automatically switches from fixture-only mode to making real HTTPS calls** against `VOYARA_HOTELBEDS_BASE_URL` — it prints `=== LIVE MODE ===` at the top of its output when this happens, so there is never any ambiguity about whether a run was real or fixture-based.
3. Compare the live response shapes against `hotelbeds-contract.ts` and `hotelbeds-mapper.ts`. If Hotelbeds' actual sandbox returns different field names than modeled (most likely candidates: exact `rateType`/`rateClass` enum values, whether `sellingRate` is present on your account tier, exact cancellation-policy date formatting), update the mapper — this is a normal, expected part of a first real certification run, not a sign anything was built incorrectly.
4. Re-run the full focused test suite (`tests/phase-3c-part2/hotelbeds-adapter.test.ts`) after any mapper correction to confirm the fixture-based tests still pass against the corrected mapping logic.
5. Only after a live certification run succeeds should `VOYARA_SUPPLIER_MODE=SANDBOX` / `VOYARA_SUPPLIER_ADAPTER=hotelbeds` be set in any shared (Preview) environment.

## 5. Security and audit expectations

- Credentials are read server-side only (`readHotelbedsCredentials()`), never exposed to the browser, never logged (the structured logger's secret-key redaction from Phase 3C Part 1 covers any accidental context object containing a key named `secret`/`apikey`/etc., but the adapter itself never logs credentials in the first place).
- Every search, availability, revalidation, and booking-preparation call writes a **sanitized** audit row to `supplier_requests`/`supplier_responses` (operation, mode, supplier id, correlation id, actor id / ok, error kind, source, simulated flag, timestamps). These tables have no column for a raw request body, response body, header, or credential — it is not possible for this audit path to leak one, by construction of the schema itself (Phase 3A).
- `commercial_source` on every offer this adapter produces is `SANDBOX`, never `LIVE` — enforced structurally: the registry has no code path that can construct this adapter (or any adapter) in `LIVE` mode.

## 6. Go-live prerequisites (for a future phase — not started here)

Activating `VOYARA_SUPPLIER_MODE=LIVE` for Hotelbeds is a **separate, future decision** requiring at minimum:
- A signed commercial agreement with Hotelbeds (the supplier-direct contract referenced in the founder's own financial model).
- Real production credentials, separate from sandbox ones.
- A live certification run identical in spirit to §4 but against production data, plus a defined go/no-go review.
- Explicit removal of the registry's current `LIVE_NOT_AVAILABLE` fail-closed throw for Hotelbeds specifically — a deliberate code change made in its own reviewed phase, not a config flip. **This phase makes no such change and none should be inferred from anything in this runbook.**
- Live payment activation is a fully separate track (Phase 3A/3B's simulated payment adapter) and is explicitly out of scope for this document.

## 7. Rollback procedure

Deactivating Hotelbeds at any time requires no code change and no migration:
1. Set `VOYARA_SUPPLIER_MODE=SIMULATION` (and `VOYARA_SUPPLIER_ADAPTER=simulation`, the default) in the affected environment.
2. Redeploy (or, for a running Vercel deployment, update the environment variable and trigger a redeploy — env var changes are not picked up by already-running server instances).
3. No data migration is needed: `quotes.source` already records `SANDBOX` vs `SIMULATED` per quote, so historical Hotelbeds-sourced quotes remain correctly labelled after rollback; only new quotes stop being sourced from Hotelbeds.
4. If credentials are suspected compromised, rotate them at Hotelbeds' dashboard first, then update `VOYARA_HOTELBEDS_API_KEY`/`VOYARA_HOTELBEDS_API_SECRET` — the adapter has no credential cache; the next call picks up the new value from the environment immediately.

## 8. Confirmation: booking remains human-controlled

This is a structural guarantee, not a policy statement:
- The `SupplierAdapter` interface (shared by every adapter, unchanged) has no method that confirms, charges, or cancels a booking — only `prepareBooking()`, which returns a payload whose `requiresHumanApproval` field is typed as the **literal** `true` (not a boolean default) — it is not possible for any adapter, including this one, to return a booking-preparation payload that skips human review; the type system rejects it at compile time.
- `tests/phase-3c-part2/hotelbeds-adapter.test.ts` mechanically verifies (by scanning the adapter's own source with comments stripped) that no code path constructs a request to Hotelbeds' booking-confirmation endpoint at all — this is not just untested, it is structurally absent.
- Everything downstream of adapter output — the Human Approval Gate, content-hash approval, and booking-preparation authority already built in Phase 3A/3B — is unmodified by Phase 3C Part 2 and continues to gate every booking exactly as before.
