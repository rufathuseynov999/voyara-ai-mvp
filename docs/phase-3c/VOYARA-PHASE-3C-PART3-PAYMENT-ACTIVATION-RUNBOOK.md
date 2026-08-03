# VOYARA AI — Phase 3C Part 3 Runbook: Hosted Payment Provider Activation

Scope: provider-neutral SANDBOX activation path for exactly one hosted payment provider — **no provider has been approved yet.** No autonomous booking, no refund execution, no supplier confirmation is activated by this phase or this document.

---

## 1. What was actually done — and what was not

**No payment provider has been approved by the founder.** Checked explicitly: environment variables (none), uploaded documents (the founder's financial model discusses supplier-direct payment *percentages* for cash-flow modeling and references "the payment reserve" and "payment fees" as a cost line, but names no specific processor, bank, or gateway), and the codebase itself (no provider name appears anywhere in `env-core.ts`, `payment-registry.ts`, or any prior phase's work). **This phase does not invent one.**

**Done, and tested (25/25 focused tests + 13/13 fixture certification):** a complete, provider-neutral `HostedCheckoutPaymentAdapter` implementing the existing `PaymentAdapter` interface (unchanged) — payment-intent creation, status lookup, cancellation, refund *preparation* (never execution), HMAC-SHA256 webhook signature verification (the exact scheme `SimulationPaymentAdapter` already declared as "what a real adapter must implement" in Phase 3A — not invented here, implemented for real), and a registry that fails closed when credentials are absent or LIVE is requested.

**Explicitly reused, not rebuilt:** sanitized payment-event persistence (`payment_intents`, `payment_events`, `payment_webhook_receipts`, `payment_reconciliations`) already existed and was already wired by `SupabaseQuoteStore` since Phase 3A — this phase writes no new persistence code. Exact reconciliation (amount/currency/reference/quote-ownership/expiry/duplicate detection) already existed in `reconciliation.ts`, exhaustively tested in earlier phases — this phase's tests call that real function with adapter-shaped data rather than re-testing its internals.

**Explicit, load-bearing honesty:** no real HTTPS call has ever been made to any payment provider from this environment. `hosted-checkout-contract.ts` is VOYARA's own minimal reference request/response shape, not modeled on any specific named provider's documented API (unlike the Hotelbeds supplier adapter in Part 2, where a specific real supplier was named and its actual documented contract was used). Once a provider is chosen, `hosted-checkout-contract.ts` and `hosted-checkout-adapter.ts`'s request/response handling will very likely need adjustment to match that provider's real API — `npm run certify:hosted-payment` is built to surface that gap immediately once real credentials exist.

---

## 2. The founder decision required before any further work

**A specific payment provider must be chosen and approved before this adapter can be certified or used.** This is a business decision this document does not make. Candidates worth evaluating, given VOYARA's Azerbaijan-first, CIS-expanding market and the founder's own stated preference for local rails:

- **Local Azerbaijani bank gateways** (e.g., a PASHA Bank or Kapital Bank merchant/payment-gateway product) — likely lowest domestic card-acceptance friction and fee structure, but integration documentation, sandbox availability, and English-language developer support vary by bank and should be confirmed directly with each bank's merchant-services team.
- **Regional/international hosted-checkout processors** with Azerbaijan or CIS support (evaluate current AZN settlement support, 3-D Secure requirements, and payout timing — do not assume any specific provider's current feature set without checking their live documentation, since this can change).
- Whichever is chosen, confirm it can issue **signed webhooks** (HMAC or equivalent) and a **sandbox/test environment** before committing — both are load-bearing requirements for this adapter's architecture (detection-then-verification, never trust-on-receipt).

## 3. Required merchant account and provider actions (once a provider is chosen)

1. Apply for a merchant account with the chosen provider; complete their KYC/business-verification process (this is a compliance step with no code component, and Azerbaijani businesses may face provider-specific documentation requirements — confirm directly with the provider).
2. Request **sandbox/test credentials** separate from any eventual production credentials.
3. Configure the provider's webhook settings to point at VOYARA's existing webhook-ingestion path and obtain the **webhook signing secret** (or equivalent) the provider issues — the exact verification scheme in `hosted-checkout-adapter.ts` (HMAC-SHA256 over `timestamp.body`) may need to be adapted to match the provider's actual signing scheme once known.
4. Obtain the provider's API reference documentation and sandbox test-card/test-transaction guide.

## 4. Required environment variables

| Variable | Notes |
|---|---|
| `VOYARA_PAYMENT_PROVIDER_NAME` | Free-text human label (e.g. `"payriff"`, `"pasha-gateway"`) — **no behavior depends on this value**; it exists only so operators can see which provider a deployment is configured for. |
| `VOYARA_PAYMENT_MERCHANT_ID` | The merchant/account identifier issued in §3. |
| `VOYARA_PAYMENT_API_KEY` | Server-only. Never prefix with `NEXT_PUBLIC_`. |
| `VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET` | Server-only. Used to verify inbound webhook signatures. |
| `VOYARA_PAYMENT_BASE_URL` | The provider's sandbox API base URL. Must be HTTPS. |
| `VOYARA_SUPPLIER_MODE` / `VOYARA_PAYMENT_MODE` | Existing (Phase 3A). `VOYARA_PAYMENT_MODE` must be `SANDBOX` and `VOYARA_PAYMENT_ADAPTER` must be `hosted-checkout` to activate this adapter at all. Every template shipped so far keeps both at `SIMULATION` by default. |

All four Hosted-payment variables fail closed if missing (`CREDENTIALS_MISSING`) and are rejected if placeholder-shaped, using the same detector hardened in Phase 3C Part 1.

## 5. Certification steps (do this before any wider use)

1. Set the environment variables from §4 with the real sandbox credentials.
2. Run:
   ```bash
   npm run certify:hosted-payment
   ```
   With real credentials present, this **automatically switches from fixture-only mode to making real HTTPS calls** — it prints `=== LIVE MODE ===` at the top of its output whenever this happens.
3. Compare the live responses against `hosted-checkout-contract.ts`. Update `hosted-checkout-contract.ts` and `hosted-checkout-adapter.ts`'s request/response handling to match the real provider's actual field names and endpoints — expect this to be necessary; it is a normal part of a first real certification, not a sign of a defect.
4. If the provider's webhook signing scheme differs from HMAC-SHA256(`timestamp.body`, secret), update `verifyWebhookSignature()` and `signHostedCheckoutWebhook()` to match exactly — this is the single most safety-critical piece of this adapter and must be verified against the provider's own documentation, not assumed.
5. Re-run `tests/phase-3c-part3/hosted-payment-adapter.test.ts` after any correction.
6. Only after a live certification run succeeds should `VOYARA_PAYMENT_MODE=SANDBOX` be set in any shared (Preview) environment.

## 6. Security and audit expectations

- Credentials are server-only, never logged, never exposed to the browser — matches the pattern established for Hotelbeds in Part 2.
- Every payment intent, webhook receipt, and reconciliation event is already persisted via the existing `payment_intents`/`payment_events`/`payment_webhook_receipts`/`payment_reconciliations` tables (Phase 3A) — unchanged by this phase.
- Webhook signature verification uses `timingSafeEqual` (constant-time comparison) to prevent timing side-channel attacks — inherited unchanged from the pattern `SimulationPaymentAdapter` already established.
- `commercial_source` on every payment this adapter produces is `SANDBOX`, never `LIVE` — the registry has no code path that can construct this or any payment adapter in `LIVE` mode.

## 7. Go-live prerequisites (a separate, future decision)

Activating `VOYARA_PAYMENT_MODE=LIVE` requires, at minimum: a signed commercial agreement with the chosen provider, real production credentials, a live certification run with a defined go/no-go review, and an explicit, separately-reviewed code change removing the registry's current `LIVE_NOT_AVAILABLE` fail-closed throw. **This phase makes no such change and none should be inferred from anything in this document.** Live supplier activation (Hotelbeds, Phase 3C Part 2) is a separate, independent track from live payment activation — both must clear their own go-live review before any commercial pilot.

## 8. Rollback procedure

1. Set `VOYARA_PAYMENT_MODE=SIMULATION` (and `VOYARA_PAYMENT_ADAPTER=simulation`, the default) in the affected environment; redeploy.
2. No data migration needed: `payment_intents.source` already records `SANDBOX` vs `SIMULATED` per record, so historical data remains correctly labelled.
3. If credentials are suspected compromised: rotate at the provider's dashboard first, then update the environment variables — the adapter has no credential cache.

## 9. Confirmations: refunds and booking remain human-gated

Structural guarantees, not policy statements:
- `PaymentAdapter.prepareRefundRequest()` returns a `RefundRequestPreparation` whose `requiresHumanApproval` field is the **literal** `true` — not a boolean default. There is no method on the interface, implemented or not, that executes a refund.
- `tests/phase-3c-part3/hosted-payment-adapter.test.ts` mechanically verifies (comments stripped, source scanned) that no code path in the adapter constructs a refund-execution or booking-confirmation request.
- **Detection is never verification**: `createPayment()` always starts a payment `PENDING`; a provider-reported `PAID` status maps only to `detectedStatus: DETECTED`. Only an exact reconciliation match (`reconcilePayment()`, unmodified since Phase 3A) can set `verifiedStatus: VERIFIED` / `reconciliationStatus: MATCHED`.
- **No booking preparation before a genuinely MATCHED reconciliation**: `prepareBooking()` (unmodified since Phase 3A) refuses with `RECONCILIATION_NOT_MATCHED` for anything short of an exact match — proven directly against this adapter's fixture-derived webhook data in the Part 3 test suite (wrong amount, wrong currency, missing reference, and duplicate-reference scenarios all correctly block preparation).
