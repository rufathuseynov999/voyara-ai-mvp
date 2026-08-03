# VOYARA AI — Production Launch Checklist

Owner: Rufat Huseynov  
Initial market: Azerbaijan  
Application version: `0.12.0`

This is an execution checklist, not an architecture document. A launch is **NO-GO** until every mandatory item below has dated evidence and an accountable human owner.

## 1. Founder decisions required before public commercial launch

- [ ] FDR-002: approve cancellation, compensation and Refund policy with legal review.
- [ ] Approve the Customer-facing benefits for Smart, Plus, Premium, Black, Starter, Standard and Professional; Enterprise may remain Custom.
- [ ] Approve published Support operating hours and the urgent-escalation manual fallback.
- [ ] Confirm whether launch Support uses a separate secure private-document channel; do not place passport or payment evidence in public links or ordinary fixtures.

Approval limits may remain unconfigured because commercial Approval is Founder-only in the safe launch policy. External Supplier, CRM, Payment, messaging and AI-provider integrations may remain deferred because the implemented manual fallbacks are explicit.

## 2. External launch inputs

- [ ] Register and control the Production domain.
- [ ] Create separate staging and Production managed Supabase projects.
- [ ] Protect Supabase organization owner accounts with MFA; restrict project membership.
- [ ] Create hosting environments for staging and Production.
- [ ] Add the exact server and browser variables from `.env.example` to the hosting secret store.
- [ ] Generate a unique `VOYARA_HEALTH_TOKEN`; never reuse a Supabase key.
- [ ] Set `VOYARA_RELEASE_ID` to the immutable deployed release/commit identifier.
- [ ] Configure exact Auth site and redirect URLs—no wildcards.
- [ ] Configure a trusted-domain SMTP sender and verify delivery, bounce and recovery behaviour.
- [ ] Enable managed SSL enforcement and proportionate database network restrictions.
- [ ] Confirm managed backup retention available under the selected Supabase plan.

## 3. Database promotion gate

- [ ] Run `npm run db:migrations:verify` and retain the result.
- [ ] Apply all 11 migrations to an empty staging database without `supabase/seed.sql`.
- [ ] Run `supabase db lint --level error` on staging.
- [ ] Run `supabase test db` and retain the complete pgTAP output.
- [ ] Run Supabase Security Advisor and resolve or formally accept every item.
- [ ] Run Supabase Performance Advisor and review launch query/index findings.
- [ ] Verify every `public` and `private` table has enabled and forced RLS.
- [ ] Verify all exposed views use `security_invoker=true`.
- [ ] Verify browser Roles cannot execute any command RPC.
- [ ] Verify the public catalogue contains exactly the eight approved prices.
- [ ] Confirm `customer@voyara.example` and `founder@voyara.example` do not exist in staging or Production.

## 4. Founder bootstrap gate

- [ ] Complete `VOYARA-FOUNDER-BOOTSTRAP-RUNBOOK.md` in staging first.
- [ ] Confirm Rufat Huseynov’s real Founder identity and verified email.
- [ ] Record the one-time database-admin bootstrap ticket and immutable audit event.
- [ ] Enrol TOTP MFA and prove an AAL2 session.
- [ ] Confirm the Founder Command Center and Founder access console deny AAL1.
- [ ] Create a second controlled organization owner recovery path; this is infrastructure access, not an application Founder Role.

## 5. Application release gate

- [ ] `npm ci` passes from a clean source checkout.
- [ ] `npm run launch:check` passes in the Production deployment environment.
- [ ] `npm run verify` passes.
- [ ] `npm audit --audit-level=low` reports zero unresolved vulnerabilities or has a dated risk acceptance.
- [ ] `npm run test:browser` passes against the release candidate.
- [ ] Validate AZ default plus complete RU/EN interface states on real mobile and desktop browsers.
- [ ] Validate keyboard navigation, visible focus, landmarks, labelled controls and responsive overflow.
- [ ] Validate `/api/v1/health` publicly and `/api/v1/health/readiness` only with the dedicated monitor token.
- [ ] Confirm Production headers include CSP, HSTS, frame denial, MIME sniffing denial and restrictive Permissions Policy.
- [ ] Confirm `VOYARA_DEMO_MODE=false` and that no synthetic identity or fixture is visible.

## 6. Authority journey gate

Execute one staging journey with synthetic, non-Production data and retain exact identifiers/hashes:

- [ ] Travel Request submitted.
- [ ] Human Review completed.
- [ ] one exact Quotation Version approved, published and accepted with matching SHA-256.
- [ ] Payment detected but not automatically verified.
- [ ] Human Finance Verification completed.
- [ ] funds allocated and financial readiness evaluated separately.
- [ ] Booking created only after Acceptance plus readiness.
- [ ] Supplier execution and Supplier Confirmation captured separately.
- [ ] independent human Booking Verification completed.
- [ ] exact Voucher issued and privately visible in Trip Room.
- [ ] Support case opened from the issued Voucher and resolved without changing financial authority.
- [ ] Refund remains unavailable and blocked pending FDR-002.

## 7. Resilience and operations gate

- [ ] Execute an encrypted backup using `npm run db:backup -- --execute` in the approved secure operator environment.
- [ ] Complete a restore rehearsal only in isolated staging using `npm run db:restore:rehearsal -- --execute --backup=...`.
- [ ] Record measured backup and restore duration; do not invent RPO/RTO targets.
- [ ] Configure the hosting platform to poll the token-protected readiness endpoint.
- [ ] Configure alerts for sustained readiness failure, application 5xx rate and database availability.
- [ ] Assign human owners for Payment, Booking, Support and security incidents.
- [ ] Rehearse the incident and forward-fix procedure in `VOYARA-INCIDENT-AND-ROLLBACK-RUNBOOK.md`.

## 8. Launch decision

The Founder records one result:

- `GO` — every mandatory gate passed with evidence; or
- `NO-GO` — at least one mandatory gate remains open.

No document, test fixture, provider event or AI output may substitute for the Founder’s accountable launch decision.
