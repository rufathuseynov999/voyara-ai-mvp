# VOYARA AI — Phase 4B Activation Runbook: Dual Instagram & Payment Links

No live Meta or payment credentials exist anywhere in this project. Everything in this document is a requirements list and procedure — **no real Instagram or payment activation has occurred.**

---

## 1. Meta dual-Instagram activation requirements

VOYARA needs **two** Instagram Professional accounts feeding the same CRM, kept structurally distinct end to end (`customer_facing_brand` on every conversation, `INSTAGRAM_RTRAVEL` vs `INSTAGRAM_VOYARA` as separate `identity_kind` values):

1. **One Meta Business Manager account** owning both Facebook Pages and both Instagram professional accounts. If R-Travel already has a Meta Business account, use it; otherwise create one.
2. **Meta Business verification** — required before webhook/API access is unrestricted. This is a document-based process (business registration, address proof) that takes Meta days to weeks; start it early.
3. **Two Facebook Pages**, one linked to each Instagram professional account (Instagram messaging API requires a connected Page, even though customers interact via Instagram).
4. **Two Instagram Professional accounts**: the existing R-Travel Instagram (convert to Professional/Business if not already) and a new VOYARA Instagram account, created and connected to its own Page.
5. **One Meta App** (in Meta's Developer console) requesting the Instagram Messaging permissions for both connected Pages/accounts — a single app can serve both, distinguished by which Page/Instagram account ID each webhook event references.
6. **App Review** for the specific permissions needed (typically `instagram_manage_messages`, `pages_messaging`, and related) — Meta reviews actual use-case screenshots/video before granting production access; budget real time for this.
7. **Webhook callback URL and verification token** — VOYARA's own `/api/v1/inbox`-adjacent webhook endpoint (not yet built — see §4 gap) must be publicly reachable over HTTPS once deployed, with a verification token Meta calls once to confirm ownership.
8. **Per-account IDs and access tokens**: once connected, each Instagram professional account has its own Instagram Business Account ID and a Page Access Token (long-lived) — these are the two `external_id`-equivalent values the adapter layer will need, one per brand.
9. **Required environment variables (to be added when this work starts — none exist yet)**: something in the shape of `VOYARA_META_APP_ID`, `VOYARA_META_APP_SECRET`, `VOYARA_META_WEBHOOK_VERIFY_TOKEN`, and per-account `VOYARA_META_RTRAVEL_IG_ACCOUNT_ID` / `VOYARA_META_RTRAVEL_PAGE_TOKEN` / `VOYARA_META_VOYARA_IG_ACCOUNT_ID` / `VOYARA_META_VOYARA_PAGE_TOKEN` — exact names to be finalized when a real Instagram channel adapter is built (Phase 4C+), following the same credential-gated, fail-closed pattern already established for Hotelbeds and the payment provider.

## 2. Payment-provider sandbox requirements

No payment provider has been approved (unchanged from Phase 3C Part 3 — this remains a founder decision). Whichever provider is chosen for payment links needs, at minimum:

- A sandbox/test merchant account with hosted-checkout and recurring-payment capability (recurring is needed for the subscription transaction type this phase's contract already supports, even though subscriptions themselves are out of scope for Phase 4B's implementation).
- Supported currencies matching VOYARA's needs: at minimum AZN; USD/EUR/TRY/AED if serving CIS/GCC customers directly (the payment-link contract already validates against exactly this currency set).
- A webhook signing secret, and confirmation of the provider's actual signing scheme — `payment-link-contract.ts`'s webhook shape and `simulation-payment-link-adapter.ts`'s HMAC-SHA256(timestamp.body, secret) verification are VOYARA's own reference scheme (reused from Phase 3C Part 3), not any named provider's real one; this must be verified/adapted once a provider is chosen, exactly as flagged in the Phase 3C Part 3 runbook.
- Confirmation of whether the provider supports "R-Travel as merchant of record with VOYARA-branded checkout," since the founder's instruction requires checkout/receipt/legal disclosures to preserve R-Travel's legal merchant identity while the customer may see the VOYARA brand — not every hosted-checkout provider supports white-labeling independently from merchant-of-record identity, so this should be confirmed with candidate providers before final selection.

## 3. What Phase 4B actually built (real, tested, simulation-only)

- Payment-link data model and full state machine (draft → AAL2-approve-by-hash → create hosted checkout → deliver only into the originating conversation → verify signed webhook → reconcile → update status), using a fixture hosted-checkout URL (`https://simulation.invalid/pay/<order-reference>`) — never a real one.
- Dual-brand conversation/identity model, ready to receive real Instagram webhook events once a real adapter exists (Phase 4C+) — today, `channel-registry.ts` still only permits the `SIMULATION` channel; requesting `INSTAGRAM_DM` (or any other real channel) in `SANDBOX` or `LIVE` mode fails closed with `UNSUPPORTED_CHANNEL`, exactly as it did before this phase.
- Identity linking with the exact auto-vs-human-confirmed rules the founder specified.

## 4. What is NOT built yet (the real gap before any live activation)

- No actual Meta webhook-receiving endpoint exists (the `/api/v1/inbox` route reads/writes CRM data for staff; it does not receive inbound Instagram/Meta webhooks — that's a new, separate route needed in Phase 4C).
- No real `ChannelAdapter` implementation for Instagram exists — only `SimulationChannelAdapter`.
- No real payment provider is wired — only `SimulationPaymentLinkAdapter`.

## 5. Activation sequence (once the founder has completed §1/§2)

1. Complete Meta Business verification and App Review (§1) — this has the longest lead time; start first.
2. Choose and contract with a payment provider (§2); obtain sandbox credentials.
3. Build the real Instagram `ChannelAdapter` (Phase 4C+) — receives real webhooks, maps Meta's actual payload shape onto the existing `contacts`/`conversations`/`messages` tables (no schema change needed — this phase's tables were built generically enough to receive real channel data once a real adapter exists).
4. Build the real payment-link adapter, following exactly the certification pattern already proven for Hotelbeds and the generic hosted-checkout adapter (`npm run certify:...`-style script that auto-switches from fixture to live the moment real credentials are present).
5. Run full RLS/concurrency/webhook-idempotency proof against the real sandbox for both, mirroring what this phase already proved with simulation data.
6. Only then consider enabling `SANDBOX` mode for either channel or payment in a shared environment.

**No step in this sequence has been started beyond the code written in this phase.**
