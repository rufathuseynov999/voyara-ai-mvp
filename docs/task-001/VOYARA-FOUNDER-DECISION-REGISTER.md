# VOYARA AI — FOUNDER DECISION REGISTER

**Task:** Implementation Task 001  
**Date:** 2026-07-17  
**Rule:** This register contains only decisions not already settled by the current Founder baseline and genuinely required before external launch.

## Decision summary

No Founder decision blocks **Implementation Task 002 — Production Repository Foundation and Security Slice**. The safe defaults below allow implementation to continue without inventing product rules.

| Decision ID | Decision required | Why it is genuinely necessary | Evidence/current conflict | Safe default while pending | Required by | Options for Founder approval | Status |
|---|---|---|---|---|---|---|---|
| FDR-001 | Approve the public identity/contact and demo-fixture policy | The current public document includes Founder/family/staff/traveller names, passport-like entries, an emergency contact and a full WhatsApp destination. Their synthetic/public status cannot be established from source. External publication requires a deliberate privacy decision. | `reference/task-001/voyara-mvp-demo-july7-10.html:324-330`, `897-901`, `963-976`, `1009-1024` | Retain only the already-public Founder name supplied in the baseline; replace every traveller, family, staff, document and contact fixture with clearly synthetic data; keep phone/domain/legal-entity values in environment configuration and do not publish them until approved | External demo, Trip Room pilot and Production launch | **A. Recommended:** synthetic fixtures plus a Founder-approved public business contact; **B.** approve a documented subset of real public profile/contact data and keep all traveller/staff fixtures synthetic | OPEN — not blocking Task 002 |
| FDR-002 | Approve the customer commercial-content and legal-terms matrix beyond the fixed prices | The source presents a Free plan, plan benefits, points, rewards, referral economics, service credits, concierge/service fees, cancellation terms and refund percentages that the current baseline does not approve. Showing them as real would create commercial and legal commitments. | `reference/task-001/voyara-mvp-demo-july7-10.html:215-240`, `984-1006`, `1079-1101`, `1161-1166` | Publish the approved personal and corporate prices only; hide all unapproved benefits, rewards, fees, credits, cancellation and refund percentages; use human-reviewed case-specific terms until a legally reviewed policy is approved | Public pricing release, checkout enablement and refund workflow launch | Approve a versioned matrix covering: included/excluded benefits by tier; any Free offer; rewards/referrals; concierge/service fees; credits; cancellation/refund terms; effective date and legal review owner | OPEN — foundation may proceed; blocks commercial Production launch |

## Decisions already settled and not reopened

The following are implementation authorities, not Founder questions:

- Azerbaijani is the default Customer language; Russian and English are supported without mixed-language states.
- Personal prices are Smart 19/190, Plus 39/390, Premium 69/690 and Black 299/2,990 AZN.
- Corporate prices are Starter 149, Standard 299, Professional 599 AZN and Enterprise custom.
- The Human Approval Gate remains mandatory for risk-sensitive actions.
- Payment detection is separate from human Payment Verification and allocation.
- Supplier Confirmation is separate from human Booking Verification and voucher issue.
- Approval and Acceptance bind to an exact canonical quotation payload and SHA-256 hash.
- The retained eight-screen MVP is the visual starting point; it is not to be casually redesigned.
- The implementation remains a budget-conscious modular monolith on managed infrastructure with manual fallbacks.

## Decisions deliberately not requested now

No immediate Founder selection is required for a payment provider, Supplier API, CRM, messaging automation, AI model, analytics platform or infrastructure expansion. Adapter boundaries and manual operations allow the first authority slices to proceed; a vendor decision should be requested only when access, commercial terms and measured launch need make it necessary.

