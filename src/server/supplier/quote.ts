import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '@/server/bos/canonical-json';
import {
  materialCommercialFieldsSchema,
  materialFieldDifferences,
  normalizeSupplierError,
  type MaterialCommercialFields,
  type NormalizedSupplierError
} from './contract';
import {
  assertTransition,
  isTerminalQuoteStatus,
  type QuoteStatus
} from './quote-lifecycle';

/**
 * Phase 3A Part 3 — quote & quote-version contracts, immutable versioning and
 * revalidation. No payment or booking execution here. A quote's commercial
 * content lives in immutable versions; any material change creates a NEW
 * version with a new content hash and invalidates the prior approval, forcing
 * fresh Human Approval Gate review. Approved versions are never overwritten.
 */

/* ------------------------------- Contracts ------------------------------- */

export const quoteVersionSchema = z.object({
  versionNumber: z.number().int().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  material: materialCommercialFieldsSchema,
  /** Approval bound to this exact content hash; null until approved. */
  approvalReference: z.string().uuid().nullable(),
  approvalInvalidated: z.boolean(),
  createdAt: z.string(),
  /** Set when this version supersedes a prior one. */
  previousVersionNumber: z.number().int().min(1).nullable(),
  supersededReason: z.string().max(200).nullable()
}).strict();
export type QuoteVersion = z.infer<typeof quoteVersionSchema>;

export const quoteSchema = z.object({
  quoteId: z.string().uuid(),
  tenantId: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.enum([
    'DRAFT', 'SEARCHED', 'NORMALIZED', 'PREPARED', 'PENDING_HUMAN_REVIEW',
    'APPROVED', 'PRESENTED', 'CUSTOMER_ACCEPTED', 'REVALIDATION_REQUIRED',
    'PAYMENT_PENDING', 'PAYMENT_DETECTED', 'PAYMENT_VERIFIED',
    'EXPIRED', 'REJECTED', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE',
    'PAYMENT_FAILED', 'PAYMENT_MISMATCH', 'CANCELLED'
  ]),
  supplierOfferReference: z.string().min(1).max(128),
  source: z.enum(['SIMULATED', 'SANDBOX', 'LIVE', 'MANUAL']),
  correlationId: z.string().min(8).max(128),
  currentVersionNumber: z.number().int().min(1),
  versions: z.array(quoteVersionSchema).min(1),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastRevalidatedAt: z.string().nullable()
}).strict();
export type Quote = z.infer<typeof quoteSchema>;

/** Compute the content hash of a version's material terms (canonical, stable). */
export function hashMaterial(material: MaterialCommercialFields): string {
  return sha256(materialCommercialFieldsSchema.parse(material));
}

/* ------------------------------- Creation -------------------------------- */

export function createQuote(input: {
  quoteId?: string;
  tenantId: string;
  customerId: string;
  supplierOfferReference: string;
  source: Quote['source'];
  correlationId: string;
  material: MaterialCommercialFields;
  now: Date;
}): Quote {
  const material = materialCommercialFieldsSchema.parse(input.material);
  const version: QuoteVersion = {
    versionNumber: 1,
    contentHash: hashMaterial(material),
    material,
    approvalReference: null,
    approvalInvalidated: false,
    createdAt: input.now.toISOString(),
    previousVersionNumber: null,
    supersededReason: null
  };
  return quoteSchema.parse({
    quoteId: input.quoteId ?? randomUUID(),
    tenantId: input.tenantId,
    customerId: input.customerId,
    status: 'DRAFT',
    supplierOfferReference: input.supplierOfferReference,
    source: input.source,
    correlationId: input.correlationId,
    currentVersionNumber: 1,
    versions: [version],
    createdAt: input.now.toISOString(),
    expiresAt: material.offerExpiry,
    lastRevalidatedAt: null
  });
}

export function currentVersion(quote: Quote): QuoteVersion {
  const version = quote.versions.find((candidate) => candidate.versionNumber === quote.currentVersionNumber);
  if (!version) throw new Error('Quote current version is missing (corrupt quote).');
  return version;
}

/* ------------------------------ Transitions ------------------------------ */

/** Move a quote to a new status, enforcing the guarded transition table.
 *  Returns a new quote object (input is treated as immutable). */
export function transitionQuote(quote: Quote, to: QuoteStatus): Quote {
  assertTransition(quote.status, to);
  return { ...quote, status: to };
}

/** Approve the current version, binding an approval reference to its exact hash.
 *  Only permitted from PENDING_HUMAN_REVIEW. */
export function approveCurrentVersion(quote: Quote, approvalReference: string): Quote {
  const next = transitionQuote(quote, 'APPROVED');
  const versions = next.versions.map((version) =>
    version.versionNumber === next.currentVersionNumber
      ? { ...version, approvalReference, approvalInvalidated: false }
      : version);
  return { ...next, versions };
}

/* ------------------------------ Versioning ------------------------------- */

/** Append a new immutable version for changed material terms. The previous
 *  version is preserved untouched; its approval (if any) is invalidated. The
 *  new version starts unapproved, forcing fresh Human Approval Gate review. */
export function supersedeWithNewVersion(
  quote: Quote,
  nextMaterial: MaterialCommercialFields,
  supersededReason: string,
  now: Date
): Quote {
  const previous = currentVersion(quote);
  const material = materialCommercialFieldsSchema.parse(nextMaterial);
  const newVersionNumber = quote.currentVersionNumber + 1;

  const newVersion: QuoteVersion = {
    versionNumber: newVersionNumber,
    contentHash: hashMaterial(material),
    material,
    approvalReference: null,
    approvalInvalidated: false,
    createdAt: now.toISOString(),
    previousVersionNumber: previous.versionNumber,
    supersededReason
  };

  // Preserve all prior versions immutably; only flip the prior version's
  // approval to invalidated (without deleting its approvalReference for audit).
  const versions = quote.versions.map((version) =>
    version.versionNumber === previous.versionNumber
      ? { ...version, approvalInvalidated: true }
      : version);

  return {
    ...quote,
    versions: [...versions, newVersion],
    currentVersionNumber: newVersionNumber
  };
}

/* ------------------------------ Revalidation ----------------------------- */

export type MaterialChange = {
  field: keyof MaterialCommercialFields;
  previous: unknown;
  next: unknown;
};

export type RevalidationOutcome =
  | { kind: 'UNCHANGED'; quote: Quote }
  | { kind: 'EXPIRED'; quote: Quote }
  | { kind: 'SUPPLIER_UNAVAILABLE'; quote: Quote }
  | { kind: 'MATERIAL_CHANGE'; quote: Quote; changes: MaterialChange[] }
  | { kind: 'SUPPLIER_ERROR'; quote: Quote; error: NormalizedSupplierError };

/** The result a supplier revalidation feed provides to the engine. */
export type RevalidationInput =
  | { ok: true; material: MaterialCommercialFields }
  | { ok: false; error: NormalizedSupplierError };

/**
 * Revalidate a quote's current version against fresh supplier data.
 *
 * Outcomes:
 *  - expired offer         → EXPIRED (status EXPIRED)
 *  - supplier unavailable  → SUPPLIER_UNAVAILABLE (status SUPPLIER_UNAVAILABLE)
 *  - other supplier error  → SUPPLIER_ERROR; approved content is NOT changed
 *  - material change        → new immutable version, prior approval invalidated,
 *                            status PRICE_CHANGED (fresh approval required)
 *  - unchanged             → retain version, update lastRevalidatedAt
 *
 * Never silently replaces approved terms.
 */
export function revalidateQuote(
  quote: Quote,
  input: RevalidationInput,
  now: Date
): RevalidationOutcome {
  if (isTerminalQuoteStatus(quote.status)) {
    // Terminal quotes are not revalidated; treat as a safe no-op error.
    return { kind: 'SUPPLIER_ERROR', quote, error: normalizeSupplierError('VALIDATION') };
  }

  // Expiry is checked first and independently of supplier response.
  if (Date.parse(quote.expiresAt) <= now.getTime()) {
    const expired = quote.status === 'EXPIRED' ? quote : transitionQuote(quote, 'EXPIRED');
    return { kind: 'EXPIRED', quote: expired };
  }

  if (!input.ok) {
    if (input.error.kind === 'UNAVAILABLE') {
      const unavailable = transitionQuote(quote, 'SUPPLIER_UNAVAILABLE');
      return { kind: 'SUPPLIER_UNAVAILABLE', quote: unavailable };
    }
    // Any other supplier failure must NOT alter approved commercial content.
    return { kind: 'SUPPLIER_ERROR', quote, error: input.error };
  }

  const previous = currentVersion(quote);
  const differences = materialFieldDifferences(previous.material, input.material);

  if (differences.length === 0) {
    return {
      kind: 'UNCHANGED',
      quote: { ...quote, lastRevalidatedAt: now.toISOString() }
    };
  }

  // Material change: create a new immutable version and require fresh approval.
  const superseded = supersedeWithNewVersion(
    quote,
    input.material,
    `Material change on revalidation: ${differences.join(', ')}`,
    now
  );
  const flagged = { ...superseded, status: 'PRICE_CHANGED' as QuoteStatus, lastRevalidatedAt: now.toISOString() };
  const changes: MaterialChange[] = differences.map((field) => ({
    field,
    previous: previous.material[field],
    next: input.material[field]
  }));
  return { kind: 'MATERIAL_CHANGE', quote: flagged, changes };
}

/** True when the current version carries a valid, non-invalidated approval. */
export function hasValidApproval(quote: Quote): boolean {
  const version = currentVersion(quote);
  return version.approvalReference !== null && !version.approvalInvalidated;
}
