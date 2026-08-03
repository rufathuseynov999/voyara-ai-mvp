# VOYARA AI — Phase 4E R-Travel Migration Runbook & Founder Input Checklist

**No real R-Travel supplier, contract, or customer data has been used or migrated anywhere in this project.** Everything below is a requirements list and procedure. Every test and certification this phase ran used generated fixture data only.

---

## 1. What this phase actually built

A structured operating layer over R-Travel's existing partner, contract, and supplier operations: a canonical supplier/partner registry, contract authority with approval-by-content-hash and full version history, secure document references, a portal-assisted operational workflow, hotel/tour/DMC/transfer/insurance/visa/activity/VIP service-booking records, human-controlled air-ticketing records, a dry-run-first reversible data-migration system, transparent supplier ranking, and read-only CRM/Founder reporting.

**R-Travel remains the legal merchant, supplier-contract authority, booking authority, invoicing authority, and refund/chargeback authority throughout** — nothing in this phase changes that; it structures and records R-Travel's existing authority, it does not transfer any of it to VOYARA's AI.

## 2. Founder input checklist — exactly what is needed before real migration

Please prepare the following. **Do not include passwords in any document, spreadsheet, or chat message** — credential activation is handled separately via secure environment-secret configuration (see §4).

1. **Company legal details** — R-Travel's exact legal entity name(s), registration details, and any related entities that appear on supplier contracts.
2. **Current supplier list** — every active hotel wholesaler, DMC, tour operator, consolidator, transfer/insurance/visa/activity provider, etc., with legal name and trading name.
3. **Contract files and amendments** — the actual signed documents (PDF or scanned) for every active supplier agreement.
4. **Account-manager contacts** — name, email, phone, per supplier, for whoever at R-Travel owns that relationship.
5. **Supplier portal names and URLs** — which portals exist and their web addresses (never the login credentials themselves in this list).
6. **API documentation** where any supplier offers one — technical docs, sandbox endpoints, whatever exists.
7. **Commercial terms** — NET rates vs. commission structures, currencies, payment terms per supplier.
8. **Commission and markup rules** — the actual percentages/formulas R-Travel currently applies.
9. **Cancellation and refund terms** — per supplier/contract, exactly as currently agreed.
10. **Hotel, tour, DMC, and air-ticketing partner details** — anything not already covered in #2.
11. **Transfer, insurance, visa, and activity partner details** — same.
12. **Active bookings and future trips** — an export of everything currently in flight, so nothing falls through the gap during migration.
13. **Customer and lead exports** — with each contact's actual email/phone (required for safe duplicate detection — see §3), lawful basis/consent status, and communication preferences.
14. **Corporate and agency-partner lists** — B2B relationships distinct from individual customers.
15. **Data-processing and marketing-consent status** — for every customer/lead record, so VOYARA never sends marketing communication without a documented lawful basis.
16. **Which suppliers should be activated first** — a founder priority order, since not everything needs to migrate on day one.

## 3. How customer migration protects against bad merges

This project's migration system **never merges customers by name alone** — verified this directly against real fixture data in both the hermetic test suite and the dry-run certification script. Two import rows with an identical name are kept as provisionally distinct records unless a **verified email or phone number** on the row matches an email/phone already on file for an existing contact. A row with neither a usable email nor phone is **rejected outright** — not imported with a guessed identity, not silently merged into the nearest name match.

This means: the customer export in item 13 above should include real email/phone data wherever it exists in R-Travel's current system, since that is what makes safe, accurate migration possible. Rows without either will be rejected and flagged for manual review rather than imported incorrectly.

## 4. Credential activation (separate from any document or chat)

Once suppliers are prioritized (item 16), any supplier with a real API (not just a portal) will need its credentials added via the same secure environment-secret pattern already used throughout this project for every other integration (WhatsApp, voice, LLM, payment) — never inside a document, spreadsheet, or chat message, and never inside this project's database as free text. This is a technical step to complete once the founder has selected which suppliers to prioritize.

## 5. Import format support — exactly what exists today

- **CSV**: fully implemented and tested — quoted fields with embedded commas parse correctly, verified both in the hermetic suite and the dry-run certification script (10/10 real checks pass).
- **XLSX**: **not implemented in this build.** The well-known `xlsx`/SheetJS library was evaluated and deliberately **not added**, because the currently available version carries known high-severity vulnerabilities (prototype pollution, a regular-expression denial-of-service issue) that are inconsistent with this project's security discipline. Adding real XLSX support requires either a properly vetted, actively-patched library (re-evaluated at the time it's needed) or a conversion step (XLSX → CSV) before import. This is a genuine, honestly-reported gap, not a fabricated capability.

## 6. The migration procedure once real data is provided

1. Founder provides the items in §2, in whatever format is available (CSV preferred; XLSX will need conversion per §5).
2. Each batch runs as a **DRY_RUN** first — this validates every row, reports duplicates and rejections, and writes **nothing** authoritative anywhere else in the schema. This is always safe to run repeatedly.
3. A human (the founder or an authorized AAL2 staff member) reviews the dry-run's validation report — accepted count, rejected count, duplicate count, and the specific reason for every rejection.
4. Only once reviewed does a human explicitly **commit** the batch — this requires a real AAL2 approver id; there is no path to committing a batch without one, enforced both in application code and by the database's own CHECK constraint.
5. If something is wrong after commit, the entire batch can be **reversed by its batch id** — every row it actually applied is unwound; rows that were rejected or flagged as duplicates were never applied in the first place, so there's nothing to reverse for them.

## 7. What is explicitly NOT claimed

- No real R-Travel supplier, contract, customer, booking, or financial data has been imported, migrated, or even seen by this project.
- No real supplier portal credential exists anywhere in this codebase, and none is stored in any document, database field, or chat transcript this project has access to.
- No AI-autonomous supplier-portal login, booking confirmation, ticket issuance, cancellation, or refund exists — every one of those requires an explicit human actor, enforced structurally (proven by source-scan tests) and at the database level (CHECK constraints).
