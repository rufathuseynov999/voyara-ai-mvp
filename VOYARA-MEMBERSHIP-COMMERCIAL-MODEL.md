# VOYARA AI — Membership Commercial Model

**Status:** Operator reference document. Prices and product facts below are taken directly from the authoritative source code (`src/lib/membership-catalogue.ts`) and verified against the passing test suite. Financial figures not present in the repository are marked **TBD** or given as **formulas** — none are invented. Where an illustrative number appears, it is explicitly labeled illustrative and is not a forecast.

---

## 1. Executive Commercial Summary

VOYARA AI sells **ongoing permission to work on the member's behalf**, not individual bookings. The membership fee buys continuous AI-prepared research, comparison, and coordination across a trip's lifecycle; every commercially binding step — price, booking, payment, cancellation — still requires human approval (the Human Approval Gate, "HAG"). This is the trust mechanism the business is built on, and it is enforced at the code and database level, not just described in marketing copy (see §11 and the Source-of-Truth Appendix).

Two membership tracks exist side by side:
- **Personal** (Smart / Plus / Premium / Black) — individual and family travel, sold on a public, fixed-price ladder.
- **Corporate** (Starter / Standard / Professional / Enterprise) — team travel governance, sold on a fixed ladder up to a custom Enterprise tier.

Revenue is designed to be **subscription-first**: the membership fee is the primary, predictable line; booking margin, concierge fees, ancillary upsells, and corporate retainers are secondary and, as of this document, **structurally prepared but not yet financially quantified** — see §6 and §8 for exactly what is and is not known.

---

## 2. Personal and Corporate Plan Architecture

### Personal — inheritance model ("Everything in X, plus…")

```
Smart  →  Plus  →  Premium  →  Black
```

Each tier inherits every benefit of the tier below it and adds its own increment. This is enforced in code (`getFullBenefitList()` in `membership-catalogue.ts`), not just in copy — a Plus member's benefit list is provably a superset of Smart's.

### Corporate — inheritance model

```
Starter  →  Standard  →  Professional  →  Enterprise
```

Same inheritance mechanism, same enforcement.

---

## 3. Exact Plan Prices, Annual Savings, Features and Upgrade Logic

All prices below are the **locked** values in `LOCKED_PLAN_PRICES` (`src/server/agents/subscriptions/plan-authority.ts`), re-verified against `membership-catalogue.ts` and the 39-test locale-matrix suite at the time of writing.

### Personal

| Plan | Monthly | Annual | Annual saving | "12 months for the price of 10" |
|---|---|---|---|---|
| Smart | 19 ₼ | 190 ₼ | **38 ₼** | ✓ |
| Plus | 39 ₼ | 390 ₼ | **78 ₼** | ✓ |
| Premium | 69 ₼ | 690 ₼ | **138 ₼** | ✓ |
| Black | 299 ₼ | 2,990 ₼ | **598 ₼** | ✓ |

Annual saving = `monthly × 12 − annual`, computed programmatically by `getResolvedPricing()`, not hand-typed — this is the same function both the app and the standalone demo call, so it cannot silently drift from the locked prices.

### Corporate

| Plan | Monthly | Annual (public) |
|---|---|---|
| Starter | 149 ₼ | — (not offered) |
| Standard | 299 ₼ | — (not offered) |
| Professional | 599 ₼ | — (not offered) |
| Enterprise | Custom | Custom |

No corporate annual price is published; Enterprise pricing is negotiated per contract (`isCustomPriced: true` in the catalogue — the only plan with this flag).

### Personal capability matrix

| Capability | Smart | Plus | Premium | Black |
|---|:---:|:---:|:---:|:---:|
| Member-access rates | ✓ | ✓ | ✓ | ✓ |
| AI-assisted research | ✓ | ✓ | ✓ | ✓ |
| Family / multi-destination planning | — | ✓ | ✓ | ✓ |
| Visa, insurance, transfer, eSIM, activity coordination | — | ✓ | ✓ | ✓ |
| Premium-hotel / complex itinerary handling | — | — | ✓ | ✓ |
| Concierge level | None | Standard | Managed | Named manager |
| Service priority | Standard | Priority | Priority | Highest |
| 24/7 AI reception | — | — | — | ✓ |
| Named travel manager | — | — | — | ✓ |
| Human approval before booking/payment | ✓ | ✓ | ✓ | ✓ |

### Corporate capability matrix

| Capability | Starter | Standard | Professional | Enterprise |
|---|:---:|:---:|:---:|:---:|
| Travel-request intake | ✓ | ✓ | ✓ | ✓ |
| Approval workflow | ✓ (basic) | ✓ (multi-level) | ✓ | ✓ |
| Traveller profiles | — | ✓ | ✓ | ✓ |
| Policy governance | — | ✓ | ✓ | ✓ |
| Reporting | ✓ (basic) | ✓ | ✓ (advanced) | ✓ |
| Company dashboard | — | ✓ | ✓ | ✓ |
| Executive travel handling | — | — | ✓ | ✓ |
| Complex / multi-city travel | — | — | ✓ | ✓ |
| Dedicated coordination | — | — | ✓ | ✓ |
| Supplier / company-rate configuration | — | — | ✓ | ✓ |
| Custom roles | — | — | — | ✓ |
| Integrations | — | — | — | ✓ |

Both matrices are sourced from `capabilityFlags` on each plan object — a structured, locale-independent field (see the Source-of-Truth Appendix for why this exists: an earlier locale-text-inference bug was found and eliminated in favor of this authority).

### Upgrade logic

Upgrade triggers are written per-plan in the catalogue (`upgradeTrigger` field) and are customer-outcome phrased, e.g. Smart → Plus is triggered by "planning family or multi-destination travel," Premium → Black by "VIP, urgent travel or a named travel manager." There is no automated upgrade *enforcement* in the product today — upgrades are member-initiated requests routed to support (see `customer-membership-screen.tsx`); this is a **process**, not yet a self-serve billing flow with proration logic in code.

---

## 4. Target Customer and Use Case per Plan

| Plan | `bestFor` (verbatim from catalogue) |
|---|---|
| Smart | First-time members and occasional travellers |
| Plus | Frequent-travelling families and multi-destination planners |
| Premium | Complex itineraries and higher service expectations |
| Black | VIP, executive and last-minute travel — application-based |
| Starter | Small teams and startups needing centralized records |
| Standard | Mid-sized teams needing multi-level approvals |
| Professional | Companies with executive travel and complex multi-city itineraries |
| Enterprise | Large enterprises requiring custom governance and integrations |

---

## 5. Value Ladder: Free/Demo Interaction → Paid Membership

```
Anonymous visitor (standalone demo / landing page)
        ↓  sees locked pricing, plan comparison, member-value journey, HAG explanation
Trip Wizard (authenticated-free interaction)
        ↓  submits a travel request; AI drafts, human reviews
Proposal → Human Review → Customer Acceptance
        ↓  final price and conditions shown before any commitment
Membership selection (Join / Choose / Request)
        ↓  billing cycle chosen (monthly or annual)
Active member
        ↓  ongoing AI research + human-reviewed proposals + Trip Room + support
Renewal / Upgrade / Corporate expansion
```

Every arrow above corresponds to a real, code-enforced state transition (Travel Request lifecycle, Quotation/Proposal state machine, Subscription lifecycle) — this is not a marketing funnel diagram, it is the actual system architecture. The **free-to-paid conversion rate at each step is not instrumented or measured yet** — see §7.

---

## 6. Revenue Streams

| Stream | Status in this repository | Notes |
|---|---|---|
| **Subscription revenue** | Implemented and billed | The only revenue stream with real subscription-lifecycle code (`subscription-lifecycle.ts`, `recurring-payment-service.ts`), tested activation/renewal/grace/upgrade/downgrade/cancellation logic. |
| **Booking margin** | Architecturally prepared, not activated | Supplier adapters (Hotelbeds etc.) exist in fixture-certified form only (see §12); no live supplier margin has ever been earned. Margin percentage: **TBD** — no supplier contract terms are in this repository. |
| **Concierge / service fees** | Conceptual for Premium/Black tiers | No fee schedule or billing code exists for concierge labor time. |
| **Insurance, transfer, eSIM, activity upsells** | Listed as member benefits, not priced individually | The catalogue coordinates access to these categories; no per-unit pricing or commission structure exists in code. |
| **Corporate retainers** | Subscription only, as priced in §3 | No separate "retainer" line beyond the listed monthly corporate fee exists in the codebase. |
| **Referral / partner revenue** | Not implemented | No referral-tracking or partner-commission code exists in this repository. |

**Rule for anyone building projections from this document:** subscription revenue is the only stream with a real, tested, billable code path today. Every other stream above is a stated intent, not a working revenue mechanism — do not model them as if they were.

---

## 7. Unit-Economics Framework (formulas, not invented figures)

No CAC, conversion rate, churn rate, or supplier margin percentage exists anywhere in this repository's code, tests, or configuration. The formulas below are the correct framework; every input marked `[INPUT]` must come from the founder's actual, measured data before this section produces a real number.

**MRR** (Monthly Recurring Revenue)
`MRR = Σ (active subscribers per plan × plan's monthly-equivalent price)`
— for annual subscribers, monthly-equivalent = `annual price ÷ 12`.

**ARR** (Annual Recurring Revenue)
`ARR = MRR × 12`

**ARPU** (Average Revenue Per User)
`ARPU = MRR ÷ total active subscribers`

**Gross Booking Value (GBV) vs. Recognized Revenue**
`GBV = Σ (booking value paid by customers through the platform)`
`Recognized Revenue = subscription revenue + (GBV × booking margin %) + concierge/service fees + upsell revenue`
— GBV must never be reported as company revenue; only the margin/fee slice is. **Booking margin % = TBD** (§6).

**Contribution Margin**
`Contribution Margin = Recognized Revenue − (payment-processing fees + AI/infrastructure cost + concierge labor cost directly attributable to serving that revenue)`
— `payment-processing fees` [INPUT, provider-dependent], `AI/infrastructure cost` [INPUT, currently near-zero since LLM routing is simulation-only per the runtime-readiness audit — see §12], `concierge labor cost` [INPUT].

**CAC** (Customer Acquisition Cost)
`CAC = total sales & marketing spend in period ÷ new paying members acquired in period`
— [INPUT] no marketing spend or acquisition-count data exists in this repository.

**CAC Payback Period**
`CAC Payback (months) = CAC ÷ (ARPU × gross margin %)`

**LTV** (Lifetime Value)
`LTV = ARPU × gross margin % × average customer lifetime (months) = ARPU × gross margin % ÷ monthly churn rate`
— [INPUT] monthly churn rate is not measured; no subscriber has yet completed a full lifecycle in a production environment.

**LTV : CAC**
`LTV : CAC ratio = LTV ÷ CAC`
— commonly cited healthy benchmarks (e.g. 3:1) are industry rules of thumb, not VOYARA-specific validated targets, and are not asserted here as applicable.

**Churn, Retention, Upgrade, and Annual-Plan Effects**
- `Monthly logo churn % = members lost in month ÷ members at start of month`
- `Net Revenue Retention (NRR) % = (starting MRR + expansion MRR − contraction MRR − churned MRR) ÷ starting MRR`
- Annual-plan effect on cash flow: annual billing pulls 12 months of cash forward at signup, reducing near-term churn *exposure* (a cancelled annual member has already paid) but does not reduce the underlying dissatisfaction driving churn — annual plans should be modeled as a **cash-timing** effect, not a churn-reduction assumption, absent measured evidence otherwise.

---

## 8. Base / Downside / Upside Scenario Template

**This section is a template with editable illustrative assumptions. None of the numbers below are validated, measured, or forecast — they exist only to show how the formulas in §7 combine. Replace every bracketed value before using this for planning.**

| Assumption | Base (illustrative) | Downside (illustrative) | Upside (illustrative) |
|---|---|---|---|
| Active personal subscribers (blended across tiers) | `[N]` | `[N × 0.5]` | `[N × 1.5]` |
| Active corporate accounts | `[N]` | `[N × 0.5]` | `[N × 1.5]` |
| Blended ARPU | `[TBD ₼]` | `[TBD ₼]` | `[TBD ₼]` |
| Monthly logo churn | `[TBD %]` | `[higher %]` | `[lower %]` |
| Booking margin % | `[TBD %]` | `[TBD %]` | `[TBD %]` |
| CAC | `[TBD ₼]` | `[higher ₼]` | `[lower ₼]` |

**MRR = Σ (subscribers per tier × that tier's monthly-equivalent price)** — this part of the formula is exact and locked (§3); only the subscriber counts are illustrative inputs. Everything downstream of subscriber counts and ARPU (LTV, CAC payback, contribution margin) inherits the same "illustrative, not validated" status until the founder supplies real figures.

---

## 9. Personal and Corporate Funnel Definitions

**Personal funnel (as implemented in the product, not as a marketing abstraction):**
`Landing/standalone view → Trip Wizard submission → AI research → Human-reviewed proposal → Customer Acceptance → Membership selection → Payment → Active subscription`

**Corporate funnel:**
`Corporate Desk contact ("Speak with Corporate Desk" CTA) → manual sales conversation (no self-serve corporate signup exists in code) → Corporate subscription activation (recurring-payment-service.ts, CORPORATE_SUBSCRIPTION transaction type) → seat/traveller management`

Conversion rates at each funnel stage: **not instrumented.** No analytics/funnel-tracking code exists in this repository.

---

## 10. Discounting, Trials, Refunds, Grandfathering, Annual-Renewal Rules

| Policy | Status |
|---|---|
| Free trial | **Not implemented.** No trial-period logic exists in `subscription-lifecycle.ts`. |
| Discounting / promo codes | **Not implemented.** No coupon/discount code path exists. |
| Refunds | **Not implemented as an automated flow.** No refund-execution code path exists anywhere in the codebase — confirmed explicitly by the fixture certification in `certify-hosted-payment.mjs`: "no code path constructs a refund-execution request." Any refund today would be a manual, out-of-band founder/finance decision. |
| Grandfathering (existing members keep old price after a price change) | **Not implemented.** Pricing is read live from `LOCKED_PLAN_PRICES`; there is no plan-version pinning per subscriber visible in the current schema beyond `planVersionId` existing as a field — whether it is used for grandfathering is **TBD**, requires founder/engineering decision before any price change ships. |
| Annual renewal | Implemented: `subscription-lifecycle.ts` handles renewal reconciliation, failed-renewal recording, and grace-period entry/recovery (certified in `certify:subscriptions`, 21/21 checks). |
| Cancellation | Implemented: cancel-at-period-end sets a flag without immediately terminating access (certified). |

---

## 11. Human Approval Gate — Operational Cost Implications

The HAG is not a UI label; it is enforced structurally: `prepareBooking()` always sets `requiresHumanApproval: true`, `prepareRefundRequest()` only ever prepares (never executes), and no code path in the certified adapters constructs a booking-confirmation or refund-execution request without a human step. This is a **deliberate cost center**, not free:

- Every proposal, booking action, and refund requires a human reviewer's time. This labor cost is real and is the largest unquantified cost in the model — **no per-review time or reviewer headcount cost is recorded anywhere in this repository.**
- The commercial upside of the HAG is trust and defensibility (a harder-to-copy moat than pure automation), not cost minimization. Any commercial model that assumes HAG labor cost trends toward zero as volume scales is making an unvalidated assumption and should say so explicitly.
- Founder/`>₼20,000`-level or Black-tier co-signature requirements (referenced in product materials as a policy intent) are **not currently enforced in code** as a distinct threshold-based dual-approval rule — the present system has a single AAL2 approval boundary, not a tiered-by-deal-size one. If a monetary co-sign threshold is a real requirement, it needs to be built, not assumed present.

---

## 12. AI-Agent Readiness and Commercial Implications

Statuses below are copied exactly from `VOYARA-AI-AGENT-RUNTIME-READINESS.md`, itself derived from direct source-code audit (no agent status here is asserted from architecture or intent alone):

| Agent | Status | Commercial implication |
|---|---|---|
| Voice Reception | **Simulated** | No real telephony or LLM provider is connected; cannot answer real calls today. Any "24/7 AI reception" benefit (Black tier) is a *planned* capability, not a live one — must not be sold as currently operating. |
| Sales | **Deterministic**, real module, **zero production callers** | Logic is real and tested but not wired into any live invocation path — cannot yet reduce human sales workload in production. |
| Concierge | **Activation pending** — no dedicated module exists | The "Managed concierge" / "Named travel manager" benefits (Premium/Black) are fulfilled entirely by humans today; there is no AI concierge automation to speak of commercially. |
| Operations | **Deterministic**, real module, **zero production callers** | Same caveat as Sales — real, tested, not live. |
| Corporate Desk | **Activation pending** — no dedicated module exists | "Speak with Corporate Desk" is a human-staffed function today, not an agent. |
| SMM & Content | **Deterministic**, real module, **zero production callers**; publish function does not exist at all | Cannot be sold or relied upon for actual content publication yet. |
| Marketing Strategist | **Activation pending** — no dedicated module exists | No automation exists; any strategy work is entirely human. |
| COO | **Deterministic**, real module, **zero production callers** | Digest/advisory logic is real but not scheduled or invoked anywhere. |

**Commercial rule, stated plainly:** none of the eight agents runs continuously or autonomously today, and none should be described to customers, investors, or in sales material as "live," "24/7," or "autonomous" without qualification. The one wired path (Voice) is simulation-mode by construction. This is not a temporary phrasing issue — it reflects the actual state of the code as of the runtime-readiness audit.

---

## 13. Launch Sequencing

**Stage 1 — Simulation / demo (current state).** All supplier, payment, WhatsApp, Instagram, and voice providers are `SIMULATION`/`NOT_CONFIGURED` (confirmed in `.env.example`, `security-scan`, and every `certify:*` script). The standalone HTML and the live app both operate demo-safely with no live transactions possible.

**Stage 2 — Controlled pilot.** Per `launch:gate`'s own verdict: **"TECHNICALLY READY FOR EXTERNAL SANDBOX ACTIVATION — COMMERCIAL PILOT BLOCKED PENDING REAL SUPPLIER AND PAYMENT CREDENTIALS."** Every readiness dimension the gate checks (content-hash approval, reserve-first idempotency, HAG presence, booking/refund preparation requiring human verification, no booking without matched reconciliation) reports READY. The blocker is purely credentials, not code.

**Stage 3 — Provider activation.** Only after: (a) real supplier/payment credentials are obtained and configured, (b) the real-PostgreSQL sandbox suite is run and passes (currently blocked in this environment by missing `docker`/`supabase` CLI — an environment gap, not a code defect), and (c) a founder-approved go/no-go decision. No stage-3 activation should occur by silently flipping an environment flag without this sequence.

---

## 14. KPI Dashboard and Operating Cadence

**Recommended weekly cadence:**
- New signups per plan (personal + corporate)
- MRR movement: new, expansion, contraction, churned (formulas in §7)
- HAG queue: proposals/bookings awaiting approval, median approval time
- Support case volume and resolution time

**Recommended monthly cadence:**
- MRR, ARR, ARPU by plan
- Logo churn %, NRR % (formulas in §7)
- Corporate account count and seat utilization
- Agent-readiness review: re-run the runtime-readiness audit whenever agent wiring changes (its own stated purpose)

**Instrumentation status:** none of the above is currently collected automatically. The Founder Command Center (`/[locale]/staff/founder`) is the intended real-data home for this dashboard once instrumentation exists; today it is a structural UI, not a populated analytics feed.

---

## 15. Commercial Risks, Guardrails, and Decision Thresholds

| Risk | Guardrail already in code | Decision threshold requiring founder input |
|---|---|---|
| Selling capabilities that don't exist yet | Honest agent-status vocabulary (§12) enforced by tests | Any new customer-facing claim about an agent must be checked against the runtime-readiness doc before publication |
| Refund exposure | No automated refund execution exists (§10) | Founder must decide and *build* a refund policy before Black/corporate deals imply one |
| Price change fairness (existing members) | None — grandfathering is undecided (§10) | Founder must decide grandfathering policy before any price change ships |
| HAG bottleneck at scale | Structural approval requirement is real and cannot be silently bypassed | Founder must decide reviewer staffing model as volume grows — no auto-approval exists to fall back on |
| Overpromising Black-tier capacity | Catalogue explicitly avoids "unlimited" language (`fairUseDisclosure` fields) | Founder must set actual Black acceptance criteria/capacity limits (currently `founderConfigurable` placeholder, no number set) |
| Live-provider activation without readiness | `launch:gate` blocks commercial pilot pending credentials | Founder sign-off required before Stage 3 (§13) |

---

## 16. Founder Action Checklist

**First 30 days**
- [ ] Decide and record: grandfathering policy for future price changes (§10)
- [ ] Decide and record: refund policy, then scope the engineering work to implement it (§10, §15)
- [ ] Set Black-tier capacity/acceptance criteria as an actual number or rule (§15)
- [ ] Begin tracking real CAC and channel-level acquisition data (§7 inputs)
- [ ] Decide which agent (Sales, Operations, SMM, or COO — the four with real, tested, unwired modules) to wire into a live invocation path first (§12)

**First 60 days**
- [ ] Instrument MRR/churn/NRR tracking (§7, §14) — even a manual spreadsheet beats no measurement
- [ ] Obtain real supplier and payment credentials for at least one provider to unblock Stage 2 piloting (§13)
- [ ] Provision a Postgres/Supabase sandbox environment (Docker + Supabase CLI) to unblock the real-database test suite
- [ ] Draft a concierge/service-fee schedule if Premium/Black concierge labor is to be billed separately (§6)

**First 90 days**
- [ ] Run a controlled pilot per the `launch:gate` sequence (§13) with real, credentialed providers on a limited customer set
- [ ] Populate §8's scenario template with real Base-case numbers from the pilot
- [ ] Reassess agent-wiring priority based on actual reviewer/ops bottlenecks observed during the pilot
- [ ] Revisit this document and correct any section that has moved from TBD to measured

---

## 17. Source-of-Truth Appendix

Every commercial and technical claim in this document traces to one of the following repository files, checked directly during preparation of this document:

- `src/lib/membership-catalogue.ts` — sole pricing, benefit, capability, and positioning authority
- `src/lib/membership-comparison-data.ts` — comparison-row logic and `capabilityFlags`-based matrix (see inline comment documenting the locale-text-inference bug this replaced)
- `src/lib/member-value-journey-data.ts`, `src/lib/ai-agent-membership-data.ts` — journey and agent content authorities
- `src/server/agents/subscriptions/plan-authority.ts` — `LOCKED_PLAN_PRICES`, the numeric pricing ground truth
- `src/server/agents/subscriptions/subscription-lifecycle.ts`, `recurring-payment-service.ts` — real billing/renewal/grace/cancellation logic
- `VOYARA-AI-AGENT-RUNTIME-READINESS.md` — agent status source
- `scripts/launch-gate.mjs` (via `npm run launch:gate`) — Stage 2/3 readiness verdict
- `scripts/certify-hosted-payment.mjs`, `certify-subscriptions.mjs`, `certify-hotelbeds-sandbox.mjs` — fixture-certified evidence that no live financial/booking transaction has occurred
- `scripts/security-scan.mjs`, `.env.example` — confirmation all providers remain in SIMULATION/NOT_CONFIGURED mode
- `Volume_2_Voyara_AI_Master_Bible.docx`, `Voyara_AI_Tesisci_Biznes_Kitabi.docx`, `voyara-mvp-demo-july7 7.html` (project reference materials) — reviewed and **explicitly excluded** as a source for any numeric unit-economics figure in this document, because each uses a different, mutually inconsistent personal/corporate pricing structure that does not match the current locked catalogue in §3, and the specific ARPU/CAC/LTV/churn figures present in the demo mockup are self-labeled as an "early low-churn cohort" illustrative dashboard state, not measured data
- `Voyara_AI_Tesisci_Biznes_Kitabi.docx`, Chapter XIII — the one figure retained from this material: the founder's stated Year-1 target of **2,000–3,000 active members plus a corporate portfolio by month 12**, cited here as a stated founder target, not as a figure this document computed or validated
