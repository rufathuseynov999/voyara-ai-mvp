# VOYARA AI — Founder Activation Checklist (Phase 3C, consolidated)

Every external account, decision, credential, and manual action that remains outside this codebase's ability to complete — consolidated from Parts 1–3 into one list, in the order they're actually needed.

**Nothing on this list has been done.** This is a to-do list, not a status report of completed work.

---

## A. Supabase (real authentication + database) — Phase 3C Part 1

- [ ] Create the **staging** Supabase project (for Preview deployments).
- [ ] Create the **production** Supabase project — a separate project, separate keys, never shared with staging.
- [ ] Apply all 14 migrations to each project (`supabase db push`, or manual `psql` in order — see `docs/phase-3c/VOYARA-PHASE-3C-AUTH-DEPLOYMENT-RUNBOOK.md` §6).
- [ ] In each project's Auth settings: set Site URL + redirect URLs, enable the Email provider (covers both magic-link and password sign-in), confirm TOTP MFA is enabled, customize email templates before production use.
- [ ] Run the founder-bootstrap procedure once against the production project (`docs/task-012/VOYARA-FOUNDER-BOOTSTRAP-RUNBOOK.md`) to create the first founder account.
- [ ] Record both projects' publishable/secret keys securely (a password manager or secrets vault — not this codebase, not a chat log).

## B. Vercel (hosting) — Phase 3C Part 1

- [ ] Create the Vercel project, link this repository.
- [ ] Populate environment variables per `.env.preview.example` (scoped to Preview) and `.env.production.example` (scoped to Production) — two full, separate sets.
- [ ] Set `VOYARA_RELEASE_ID` to `$VERCEL_GIT_COMMIT_SHA` for Production.
- [ ] Generate `VOYARA_HEALTH_TOKEN` and `VOYARA_WEBHOOK_SECRET` (`openssl rand -hex 32` each) for Production; give the health token to an uptime monitor pointed at `/api/v1/health/readiness`.
- [ ] (Optional) Create an error-monitoring provider account (Sentry or similar) and set `VOYARA_ERROR_MONITOR_WEBHOOK`.
- [ ] Run `npm run launch:check` against the real Production environment variables before the first production deploy.

## C. Hotelbeds (hotel supplier) — Phase 3C Part 2

- [ ] Apply for a Hotelbeds Sandbox/test account at `developer.hotelbeds.com` (or via their partner channel).
- [ ] Complete Hotelbeds' business verification process.
- [ ] Obtain sandbox API key + secret, and Hotelbeds' current Booking API v3 documentation + sandbox test-booking guide.
- [ ] Set `VOYARA_HOTELBEDS_API_KEY` / `VOYARA_HOTELBEDS_API_SECRET` (and `VOYARA_HOTELBEDS_BASE_URL` if different from the public sandbox host).
- [ ] Run `npm run certify:hotelbeds` — it will automatically switch to real HTTPS calls. Correct any field-mapping drift found in `hotelbeds-contract.ts` / `hotelbeds-mapper.ts` against Hotelbeds' actual live responses.
- [ ] Re-run `tests/phase-3c-part2/hotelbeds-adapter.test.ts` after any correction.
- [ ] Only then set `VOYARA_SUPPLIER_MODE=SANDBOX` / `VOYARA_SUPPLIER_ADAPTER=hotelbeds` in a shared environment.

## D. Payment provider — Phase 3C Part 3

- [ ] **Choose one payment provider.** No provider has been approved yet — this is a founder decision, not a technical one. See `docs/phase-3c/VOYARA-PHASE-3C-PART3-PAYMENT-ACTIVATION-RUNBOOK.md` §2 for evaluation criteria (local Azerbaijani bank gateways vs. a regional/international hosted-checkout processor).
- [ ] Apply for a merchant account with the chosen provider; complete KYC.
- [ ] Request sandbox/test credentials, separate from any eventual production credentials.
- [ ] Configure the provider's webhook settings; obtain the webhook signing secret.
- [ ] Set `VOYARA_PAYMENT_PROVIDER_NAME` / `VOYARA_PAYMENT_MERCHANT_ID` / `VOYARA_PAYMENT_API_KEY` / `VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET` / `VOYARA_PAYMENT_BASE_URL`.
- [ ] Run `npm run certify:hosted-payment` — it will automatically switch to real HTTPS calls. Correct any field-mapping or signature-scheme drift found in `hosted-checkout-contract.ts` / `hosted-checkout-adapter.ts` against the provider's actual documentation — **the webhook signature scheme is the single most safety-critical item to verify exactly.**
- [ ] Re-run `tests/phase-3c-part3/hosted-payment-adapter.test.ts` after any correction.
- [ ] Only then set `VOYARA_PAYMENT_MODE=SANDBOX` / `VOYARA_PAYMENT_ADAPTER=hosted-checkout` in a shared environment.

## E. Controlled pilot — Phase 3C Part 4

- [ ] Confirm `npm run launch:gate` reports `SANDBOX_CERTIFIED` (or better) for **both** the Hotelbeds and payment provider certification rows before proceeding — do not start a pilot on `FIXTURE_CERTIFIED` alone.
- [ ] Staff the five pilot roles (`docs/phase-3c/VOYARA-PHASE-3C-PART4-CONTROLLED-PILOT-RUNBOOK.md` §1) with real people; confirm the Approvals Officer and Booking Coordinator are different people from the quote initiator.
- [ ] Select and brief real pilot customers (§2); get explicit consent.
- [ ] Set, in writing, the per-booking and pilot-total value ceilings (§3).
- [ ] Run the pilot per the runbook's approval sequence, payment verification, supplier confirmation, and voucher delivery steps (§4–§7).
- [ ] Do daily reconciliation (§10) every pilot day without exception.

## F. Go-live (LIVE mode) — a further, separate decision, not started by any Phase 3C work

- [ ] A signed commercial agreement with Hotelbeds (referenced in the founder's own financial model as the supplier-direct contract).
- [ ] A signed agreement with the chosen payment provider.
- [ ] Real production credentials for both, separate from sandbox ones.
- [ ] Live certification runs for both, with a defined go/no-go review.
- [ ] Explicit, separately-reviewed code changes removing the registries' current `LIVE_NOT_AVAILABLE` fail-closed throws — one deliberate change per provider, each in its own reviewed change, never a config flip alone.

---

**Nothing in items A–F has an implicit deadline implied by this document.** Move through them in whatever order makes sense for VOYARA's actual business timeline; the only hard sequencing constraint is that each section's prerequisites (real credentials, then certification, then re-test) must complete in that order before enabling the corresponding `SANDBOX` mode.
