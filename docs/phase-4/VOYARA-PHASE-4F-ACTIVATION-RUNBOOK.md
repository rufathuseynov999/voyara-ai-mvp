# VOYARA AI — Phase 4F Activation Runbook: Subscriptions, Membership Entitlements & Recurring Billing

No live payment provider is connected anywhere in this build. **No recurring billing has been activated.** Everything below is a requirements list and procedure for real activation — not a claim that it has happened.

---

## 1. What this phase actually built

A complete personal and corporate subscription system: versioned, approval-by-hash plan authority (mirroring contracts from Phase 4E); a deterministic entitlement engine that never grants access from pricing-card text alone; a closed 12-state subscription lifecycle where initial activation only ever happens after a reconciled payment; a provider-neutral recurring-payment layer (tokenized references only, idempotent webhooks, exact amount/currency/plan matching); and corporate membership with strict seat-level isolation.

**The founder's locked pricing catalog is enforced in code, not just documented** — `LOCKED_PLAN_PRICES` in `plan-authority.ts` is the single source of truth, and `draftPlanVersion` structurally refuses any price that doesn't match it exactly:

| Plan | Monthly | Annual |
|---|---|---|
| Smart | 19 ₼ | 190 ₼ |
| Plus | 39 ₼ | 390 ₼ |
| Premium | 69 ₼ | 690 ₼ |
| Black | 299 ₼ | 2,990 ₼ |
| Corporate Starter | 149 ₼ | — |
| Corporate Standard | 299 ₼ | — |
| Corporate Professional | 599 ₼ | — |
| Corporate Enterprise | custom (never published) | custom (never published) |

## 2. Founder input checklist for real activation

1. **Payment provider selection** — which hosted-checkout/recurring-billing provider (the existing `VOYARA_PAYMENT_PROVIDER_NAME`, `VOYARA_PAYMENT_MERCHANT_ID`, `VOYARA_PAYMENT_API_KEY`, `VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET`, `VOYARA_PAYMENT_BASE_URL` environment variables already exist in `env-core.ts` from Phase 4B — this phase reuses that same credential surface, does not add a new one).
2. **Provider-specific webhook signature scheme** — `signRenewalWebhook`/`verifyRenewalWebhookSignature` in this build are VOYARA's own fixture/reference HMAC scheme, not any real provider's actual scheme. A real provider's signature verification must be implemented before go-live.
3. **Founder approval of the first real plan versions** — every plan in the table above needs `draftPlanVersion` + `approveAndActivatePlan` run with a real AAL2 founder/finance approver before it can grant a single real entitlement. Nothing in this build has done this against a production database.
4. **Grace-period and dunning policy** — how many days of grace period, how many retry attempts, when a failed-payment subscription should move to `SUSPENDED` vs `EXPIRED`. This build implements the state machine; it does not decide these numbers for the founder.
5. **Enterprise contract process** — since Enterprise pricing is structurally never published, each Enterprise corporate account needs a real `enterpriseContractReference` pointing at an actual signed agreement (reusing the Phase 4E document-reference system).

## 3. Credential handling

Recurring-payment tokens are references only — this schema cannot store a raw card number or a CVV (enforced by both the application layer and the database's own CHECK constraints, `recurring_payment_tokens_no_raw_card_number` and `recurring_payment_tokens_no_cvv_shaped_value`). Real activation requires the payment provider's own tokenization flow (e.g., their hosted card-collection widget) — VOYARA's backend should never see a raw card number at any point, in this build or in production.

## 4. Activation procedure

1. Select and configure the real payment provider (§2.1).
2. Implement and test the provider's real webhook signature verification, replacing the fixture HMAC scheme.
3. Draft and approve the eight plan versions in §1's table against the real production database (not this build's fixtures).
4. Run the subscription fixture certification (`npm run certify:subscriptions`) against the real environment to confirm the state machine and entitlement engine behave identically to this build's verified fixture run.
5. Begin with a small cohort of real subscriptions, monitoring renewal webhook reconciliation closely before wider rollout.
6. Only after real renewals have been observed to reconcile correctly should broader customer-facing subscription signup be enabled.

**No step in this sequence has been started beyond the code and fixtures in this phase.**

## 5. What is NOT built yet

- No real payment provider integration — everything is SIMULATION-certified only.
- No customer self-service upgrade/downgrade/cancellation mutation flow is wired to a live API route in this build; the customer-facing membership page (§6) presents these as support-mediated requests for this phase, consistent with the founder's rule that sensitive changes require AAL2 human approval.
- No dunning/retry scheduling automation exists — `markPaymentFailed`/`enterGracePeriod` are real, tested functions, but nothing in this build calls them on a timer; that requires a real scheduled job once a provider is connected.
- No real Enterprise contract has been created or referenced.

## 6. Customer-facing membership screen

`/[locale]/membership` — implemented in AZ/RU/EN, read-only display of plan comparison (using the exact locked prices), current membership status, billing cycle, renewal date, payment history, and entitlement usage. Upgrade/downgrade/cancellation are presented as support-mediated requests, not self-service mutations, in this build.

## 7. Founder Command Center

`SubscriptionOpsPanel`, mounted additively on the founder page, is read-only and reports: active subscriptions, monthly/annual split, personal/corporate split, renewals due, failed payments, grace-period accounts, scheduled upgrades/downgrades, cancellations pending, plan distribution, MRR/ARR, and 30-day churn/retention. **MRR/ARR are computed only from real ACTIVE subscriptions joined to their real approved plan price** — an active subscription whose plan price cannot be resolved is excluded from the MRR sum (not estimated), and the panel honestly displays "partial" whenever this happens rather than silently understating the true figure.
