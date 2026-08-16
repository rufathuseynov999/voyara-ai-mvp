# VOYARA — Phase E.2B Certification Report

## Status: E.2B is frozen. Every certification gate below ran fresh, in this repository, and passed.

---

## 1. What is real production architecture

- Production `AskVoyara` (`/[locale]/ask`, customer-authenticated) consumes the shared `TravelConversationPresentation`, using `interactionMode: 'COMPOSE_CONFIRM'` and `quickPromptBehavior: 'FILL_DRAFT'` — chips fill the composer, they never auto-submit. It still calls the real `/api/v1/travel-requests` `travel_request.save_draft` action, uses the real deterministic `parseIntent` parser, and still routes into the real structured Wizard. No behavior changed — only the presentation layer converged.
- Production `JourneyCanvas` (rendered wherever a customer's real Proposal/Journey is shown) consumes the shared `JourneyCanvasPresentation` via `mapPublishedProposalToJourneyCanvasViewModel`. The real, untouched `<PublishedProposals>` (proposal cards, line items, quotation hash, the `accept()` command) and `<NextActionCard>` are passed through as presentation slots — never reimplemented. `deriveJourneyNextAction` and `deriveBookingStage` remain the sole authority source; the shared presentation component makes no authority decision and imports neither domain component nor Supabase.
- The 20-point authority matrix (payment-required vs. payment-in-review vs. never-re-ask-payment vs. booking-in-progress vs. VOUCHER_ISSUED-only-ready-to-travel vs. cross-quotation isolation) is proven against the real `deriveJourneyNextAction`/`deriveBookingStage` functions, not reimplemented logic.

## 2. What is simulated production presentation

- `/[locale]/internal-preview/e2b-production/[state]` — a server-flag-gated (`VOYARA_E2B_PRODUCTION_PREVIEW_ENABLED`) harness that renders the REAL, unmodified production `<JourneyCanvas>` component with production-shaped deterministic fixtures (real `PublishedProposalView`/`CustomerPaymentRequestView`/`CustomerBookingView` contract shapes, real status enum values — nothing invented) instead of a live Supabase session. This exists because the authenticated customer route cannot render in this sandbox without live customer credentials, which this project never uses. Every state visibly displays: *"Production presentation simulation — not customer, supplier, payment or booking data."*

## 3. What is illustrative E.2B experience content

- `/[locale]/experience-preview/e2b` — the customer-facing conversational planning demo (Baku→Istanbul scenario), server-flag-gated (`VOYARA_CUSTOMER_EXPERIENCE_PREVIEW_ENABLED`). Every hotel, dining recommendation, itinerary day, and illustrative budget figure is explicitly fixture data, labeled "Experience preview — illustrative trip content," and carries a visible `ILLUSTRATIVE` evidence badge distinct from the `LIVE` badge the production harness shows.

## 4. What is not yet connected to live suppliers / not a confirmed price / not a live map

- No supplier integration exists anywhere in E.2B. No price shown in the illustrative preview is a real supplier quote. The route visualization is explicitly labeled "Illustrative route — not a live map" in both illustrative and production-simulation contexts; production's real map placeholder still reads "A map preview will appear here once destination coordinates are confirmed" — an honest unavailable state, not fabricated content.

## 5. What has no payment/booking authority

- Neither shared presentation component (`TravelConversationPresentation`, `JourneyCanvasPresentation`) can create a payment request, accept a proposal, or create a booking. Those operations remain exclusively inside `<PublishedProposals>`'s real `accept()` path and the real payment/booking API routes, which the shared components never call.

## 6. Why authenticated production screenshots required the safe harness

Real customer routes are gated by `requireViewerRole`, which requires a live Supabase session. This sandbox has no such session and never fabricates one. The harness renders the identical, unmodified production component tree with realistic fixture data instead — the only way to visually verify the converged production presentation without either skipping visual verification entirely or building a second, drifting mockup.

## 7. A real defect found and fixed during this certification pass

The first real server-rendered exercise of production `journey-canvas.tsx` → `JourneyCanvasPresentation` (via the new harness) surfaced a genuine bug that had never been caught before: a function prop (`dayWord: (n) => string`) was being passed from a Server Component across the RSC boundary into a `'use client'` component — React throws at runtime because functions are not serializable in the RSC payload. This never appeared in the preview because the preview never crosses a server/client boundary (`experience-preview-workspace.tsx` is itself `'use client'`). Fixed by replacing the function prop with a serializable `dayLabelTemplate: string` (`"Day {n}"`), used identically by both callers.

A second real defect — severe mobile overflow (564px at 390px, 783px at 320px) — was also found via the harness and traced to nested grid/flex children lacking `min-width: 0`, allowing intrinsic content width to push the entire shell wider than the viewport. Fixed with explicit `min-width: 0; max-width: 100%` on the affected `.journey-canvas*` classes. Verified 0px overflow at all tested widths afterward.

## 8. Certification evidence (fresh, this final run)

| Gate | Result |
|---|---|
| TypeScript | Clean |
| AZ/RU/EN dictionary parity | 1285/1285 keys identical across all three locales |
| Combined E.2B + UX2 + UX3 permanent suites | 193/193 |
| `npm run test:e2b:interaction` | 19/19 |
| `npm run test:e2b:browser` (illustrative preview matrix) | 60/60 combinations, 516/516 assertions |
| `npm run test:e2b:az-regression` (AZ hydration fix proof) | 248/248 assertions, across all 4 viewports × 9 Journey states |
| `npm run test:e2b:production-browser` (full production matrix) | **156/156 combinations, 1284/1284 assertions, 0 failed** |
| Full repository suite (`npm test`) | 1448 total / 1426 pass / 0 fail / 22 skip |
| Security scan | PASS |
| Production build (no preview flags) | Succeeds |
| Production build (all preview flags) | Succeeds |
| Runtime smoke (flags disabled) | 7/7 — public landing loads, staff/ask routes redirect unauthenticated, all three preview route families (experience preview, Journey production harness, Ask production harness) genuinely 404 without their flags, WhatsApp webhook fails closed unconfigured |
| Migration verification | 29/29 byte-identical against `manifest.sha256`; no migration 30 |
| Leftover server processes | Zero, confirmed after every run |

## 8a. The AZ hydration defect — root cause, fix, and closure

A real React hydration error (#418) was found via the production browser matrix, affecting every `az`-locale Journey Canvas combination and no others. Diffing the raw SSR HTML against the post-hydration DOM for an identical request found the exact mismatch:

| Field | Server (Node, full ICU) | Client (this environment's Chromium ICU) |
|---|---|---|
| Total | `1.050,00 ₼` | `AZN 1,050.00` |
| Valid until | `31 dek 2026, 00:00` | `2026 M12 31 00:00` |

Root cause: Chromium's bundled ICU lacked complete `az-AZ` locale data and silently fell back to a generic, non-Azerbaijani format instead of throwing, while Node's ICU rendered correctly — producing genuinely different server/client text. `ru-RU` and `en-US` were unaffected (both environments' ICU data is complete for those).

**Rejected approaches** (tried, evidence-based, genuinely reverted where dead code resulted): an explicit UTC `timeZone` pin, and Unicode-space normalization on the currency string. Neither addressed the actual cause and both were removed/replaced during the final fix, leaving no dead code.

**Fix**: deterministic, hand-rolled `formatAzMoney`/`formatAzDateTime` functions used only for the `az` locale branch in `published-proposals.tsx` — server and client now always agree regardless of either runtime's ICU completeness. `ru`/`en` continue using `Intl` unchanged, since that path was proven correct by the same SSR-vs-hydrated diff.

**Closure evidence**: 248/248 in the dedicated permanent regression test (`npm run test:e2b:az-regression`, which exercises the real production harness — not a source-string check), plus 156/156 in the full production matrix rerun after the fix.

## 9. Remaining limitations (honest, not hidden)

- **No live supplier inventory** exists anywhere in E.2B or its harnesses. No price shown anywhere — illustrative or production-simulated — is a real supplier quote.
- **Illustrative E.2B experience content is not confirmed**: every hotel, dining recommendation, itinerary day, and budget figure in the customer-facing preview (`/[locale]/experience-preview/e2b`) is explicitly fixture data, visibly labeled and carrying an `ILLUSTRATIVE` evidence badge distinct from the `LIVE` badge production/simulation content shows.
- **No live map** exists; the route visualization is explicitly labeled "Illustrative route — not a live map" everywhere it appears, including in the production harness.
- **Preview and production harnesses use no customer data**: both `/[locale]/internal-preview/e2b-production/[state]` and `/[locale]/internal-preview/e2b-production-ask/[state]` are server-flag-gated, use production-shaped deterministic fixtures only, and every state visibly displays "Production presentation simulation — not customer, supplier, payment or booking data."
- **Production authority remains unchanged**: `PublishedProposals`, `NextActionCard`, `deriveJourneyNextAction`, `deriveBookingStage`, and quotationId-scoped matching are all untouched, reused verbatim by the converged presentation layer — never reimplemented in a shared/presentation component.
- This remains an internal, sandboxed development environment. A real production Supabase project's actual RLS/session behavior under real user traffic, and any real customer's actual browser ICU completeness for locales beyond what this environment's Chromium build has, should still be spot-checked after deployment — the AZ hydration fix removes this environment's specific ICU gap as a source of mismatch, but real-world browser diversity is inherently broader than one CI environment's bundled Chromium.

## 10. Freeze decision

Every required gate passed with fresh evidence in this final certification turn: TypeScript, full dictionary parity, the combined permanent test suite, both the illustrative and production browser matrices (156/156 combinations, 1284/1284 assertions for production), the dedicated AZ hydration regression proof (248/248), the full repository suite (1426/1426 non-skipped tests passing), security, both build configurations, runtime smoke, and migration verification.

**E.2B is frozen.**
