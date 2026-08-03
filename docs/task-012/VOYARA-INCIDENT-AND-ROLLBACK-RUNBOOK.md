# VOYARA AI — Incident and Release Response Runbook

## Severity principle

Any suspected cross-Customer disclosure, exposed server secret, unauthorized Role, bypassed human Approval, false Payment Verification, unauthorized Booking/Voucher, or mutable material history is launch-critical.

## Immediate containment

1. Assign one human incident commander and record UTC/Baku timestamps.
2. If Customer or authority safety is uncertain, stop new commercial commands while preserving read-only evidence.
3. Revoke the affected session or apply the user-wide session cutoff.
4. Rotate exposed secrets through the hosting/Supabase secret stores; never paste them into tickets or logs.
5. Preserve immutable database events, hosting logs and release identifier. Do not edit historical rows.
6. Keep AI agents disabled from high-risk authority throughout the incident.

## Diagnosis

- Identify the exact release ID and migration manifest.
- Separate application availability from database authority integrity.
- Trace the exact version/hash chain for affected Quotation, Acceptance, Payment, Booking, Supplier Confirmation, Verification and Voucher records.
- Distinguish provider detection from human Verification.
- Determine whether any Customer saw another Customer’s data.
- Do not write passport, Payment evidence, secrets or full Customer payloads into general logs.

## Release response

Prefer these steps in order:

1. disable or route away from the faulty application release;
2. deploy the last verified application release when it remains compatible with the current schema;
3. issue a forward database migration to correct schema or policy defects;
4. use managed database recovery only under an explicit recovery decision.

Do not run destructive down migrations against immutable evidence. Do not delete or rewrite approved, accepted, verified or issued history. A database change that cannot be safely reversed must be corrected forward.

## Recovery proof

Before restoring traffic:

- run liveness and token-protected readiness checks;
- run the affected unit/database tests plus the full release suite;
- verify the eight-screen AZ/RU/EN experience at mobile and desktop sizes;
- verify Founder and staff AAL2;
- execute the affected authority chain with staging evidence;
- confirm no Refund capability was introduced while FDR-002 remains open;
- obtain accountable human go/no-go approval.

## Post-incident

Record impact, exact evidence, root cause, containment, Customer communication decision, corrective migration/release, test additions and owner. Financial loss, Customer harm and regulatory notification decisions require legal/Founder review; they must not be invented by the application or AI.
