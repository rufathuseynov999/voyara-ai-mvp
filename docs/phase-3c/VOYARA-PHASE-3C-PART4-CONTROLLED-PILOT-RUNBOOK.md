# VOYARA AI — Phase 3C Part 4 Runbook: Controlled Pilot Operations

Scope: how to run VOYARA's **first controlled pilot** once — and only once — the launch gate (`npm run launch:gate`) reports `SANDBOX_CERTIFIED` or better for both the Hotelbeds supplier and the chosen payment provider. **As of this writing, both are `FIXTURE_CERTIFIED` only — this runbook describes the procedure to follow once that changes; it does not itself authorize starting a pilot today.**

---

## 1. Internal R Travel team roles

A controlled pilot needs exactly these roles staffed by real people before it starts — matching the existing `staff`/`manager`/`finance`/`admin`/`founder` role vocabulary already in the system (no new roles are introduced):

| Role | System role(s) | Responsibility during the pilot |
|---|---|---|
| **Pilot Lead** | `founder` or `admin` (AAL2) | Go/no-go call each day; sole authority to invoke a stop condition (§10). |
| **Approvals Officer** | `staff` or `manager` (AAL2) | Reviews and approves every quote by exact content hash before presentation — the Human Approval Gate is not bypassed for pilot bookings. |
| **Payment Verifier** | `finance` (AAL2) | Reviews every `PAYMENT_DETECTED` event and only signs off once reconciliation independently confirms `MATCHED`; never treats a detected webhook as sufficient alone. |
| **Booking Coordinator** | `staff` (AAL2) | Executes the actual supplier booking action **outside** this codebase (by phone/portal to Hotelbeds, since no autonomous booking-confirmation exists anywhere in this system by design) once preparation is approved. |
| **Customer Support** | `staff` | Single point of contact for the pilot's test customers; owns incident escalation (§8). |

One person may hold multiple roles for a small first pilot, but the **Approvals Officer and Booking Coordinator must be different people** from whoever initiated the quote — the four-eyes principle the Human Approval Gate is built around should not be defeated by role-stacking.

## 2. Test customer selection

- Pilot customers must be **real people known to the founder or team** (friends-and-family or a small invited cohort) — not the general public. This is a controlled pilot, not a soft launch.
- Each pilot customer should be told explicitly, in plain language, that this is a pilot: bookings are prepared by the system but **confirmed by a human calling the supplier directly**, and refunds are **prepared, not automatic**.
- Collect explicit consent to be a pilot participant, including consent to the booking-value limit (§3) and the possibility of a manual, human-mediated resolution if anything goes wrong.

## 3. Booking value limits

- Set a **hard per-booking ceiling** for the pilot — a small, board/founder-approved number (e.g., a single room, a few nights, a currency amount the founder is personally comfortable being wrong about). This runbook does not set that number; the Pilot Lead does, in writing, before the first pilot booking.
- Set a **hard pilot-total ceiling** (sum across all pilot bookings) — do not let the pilot scale past its approved exposure just because early bookings went well.
- Both ceilings are enforced by the Approvals Officer manually reviewing the quote amount before approving — there is no automated hard-stop for this in the current codebase, and none should be assumed.

## 4. Approval sequence (per booking)

This sequence is the existing, unmodified Human Approval Gate flow — the pilot changes nothing about it, only adds human process around it:

1. Customer completes the trip wizard → quote created (`SEARCHED`/`NORMALIZED`).
2. **Approvals Officer** reviews the quote's material terms and the exact content hash, and approves (`APPROVE_QUOTE`) only if within the booking-value limit (§3).
3. Quote is presented to the customer; customer accepts.
4. Payment intent created; customer directed to the hosted payment page.
5. **Payment Verifier** waits for `PAYMENT_DETECTED`, then independently confirms `PAYMENT_VERIFIED` / `MATCHED` via reconciliation before anything proceeds — see §5.
6. **Booking Coordinator** confirms the booking with the supplier **by phone or the supplier's own portal** (never via this codebase, which has no booking-confirmation capability by design) only after step 5 is genuinely `MATCHED`.
7. **Booking Coordinator** manually records the supplier's real confirmation reference back into the system's booking-preparation record (as the human verification step the schema already requires).
8. Voucher/confirmation delivered to the customer (§7).

## 5. Payment verification

- **Detection is never verification.** A `PAYMENT_DETECTED` webhook is a signal to go check, not a signal to proceed. This is enforced in code (`reconcilePayment()`, unchanged since Phase 3A) and must also be enforced in the Payment Verifier's own habits: always look at the reconciliation record's `status` field, and proceed only on `MATCHED`.
- Any reconciliation status other than `MATCHED` (`PARTIAL`, `CURRENCY_MISMATCH`, `MISSING_REFERENCE`, `WRONG_QUOTE`, `DUPLICATE`, etc.) routes to human review by design — the Payment Verifier resolves these manually (contact the customer, check the provider's own dashboard) before any booking step proceeds.
- Never accept a customer's own claim of "I paid" as sufficient — always verify against the system's own reconciliation record.

## 6. Supplier confirmation

- The system prepares a booking payload (`prepareBooking()`) for human review; it does **not** and cannot confirm a booking with Hotelbeds — there is no code path anywhere in this build that calls Hotelbeds' booking-confirmation endpoint (mechanically verified by the Part 2 test suite).
- The Booking Coordinator confirms with Hotelbeds directly (phone/portal, per Hotelbeds' own sandbox test-booking process during the pilot) and records the real confirmation reference back manually.
- If Hotelbeds cannot confirm (sold out, price changed since preparation, etc.), the Booking Coordinator escalates to the Pilot Lead and Customer Support immediately — do not let the customer believe a booking is confirmed until the supplier has actually confirmed it.

## 7. Voucher delivery

- A voucher/confirmation is sent to the customer **only after** the Booking Coordinator has recorded a real supplier confirmation (§6) — never before.
- `isVoucherEligible()` (unchanged, Phase 3A) already encodes this as a structural gate (`MATCHED` reconciliation + prepared + human-verified booking); the pilot process should never attempt to bypass it by sending a voucher manually before that gate would pass programmatically.

## 8. Incident escalation

- Any customer-reported problem (wrong amount charged, no confirmation received, supplier dispute) goes to **Customer Support first**, who loops in the **Payment Verifier** and/or **Booking Coordinator** as relevant, and the **Pilot Lead** for anything involving money or a stop-condition question (§10).
- Use `docs/task-012/VOYARA-INCIDENT-AND-ROLLBACK-RUNBOOK.md` for anything that looks like a system/technical incident (not just a single booking issue) — e.g. webhook failures, reconciliation errors affecting multiple bookings, suspected credential compromise.
- Every incident, however small, gets a written note (who, what, when, resolution) — the pilot's whole purpose is to surface exactly this kind of information before a wider launch.

## 9. Cancellation / refund handling

- `prepareRefundRequest()` **only ever prepares** a refund request requiring human approval — it cannot execute a refund (mechanically verified, Part 3 test suite). Every refund during the pilot is executed manually, by a human, through the payment provider's own dashboard, after the Payment Verifier and Pilot Lead both sign off.
- Cancellations follow the offer's own cancellation policy (already normalized and shown to the customer before acceptance — `cancellationPolicy.kind`); do not promise a more generous cancellation term than what the accepted quote actually carried.
- Record every refund manually (amount, reason, who approved) even though the system does not automate this — the pilot's daily reconciliation (§10) depends on this record existing.

## 10. Daily reconciliation and pilot stop conditions

**Daily reconciliation** (every pilot day, done by the Payment Verifier, reviewed by the Pilot Lead):
- Every `PAYMENT_DETECTED` for the day has a corresponding `MATCHED` reconciliation, or an open, actively-worked exception.
- Every `MATCHED` payment has a corresponding supplier confirmation recorded (§6) or is actively being chased.
- Running total against the pilot-total ceiling (§3).
- Any incident opened that day (§8) reviewed for whether it should trigger a stop condition below.

**Stop the pilot immediately (Pilot Lead's sole call) if any of these occur:**
- A payment reconciles as `MATCHED` but the amount, currency, or customer does not actually match what was quoted (a genuine reconciliation-engine or process failure, not an expected mismatch state).
- Any booking is confirmed to a customer before the supplier actually confirmed it.
- A refund is executed without both Payment Verifier and Pilot Lead sign-off.
- Suspected credential compromise (Hotelbeds or payment provider) — rotate immediately per each provider's own runbook (Part 2 §7, Part 3 §8) and pause new bookings until rotated.
- The pilot-total ceiling (§3) is reached.
- Two or more customers report the same class of problem in one day.

Resuming after a stop requires the Pilot Lead's explicit written go-ahead, and a note on what was fixed or clarified before resuming.
