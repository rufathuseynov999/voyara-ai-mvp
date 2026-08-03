import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Phase 4E — secure document references. Never the document content itself
 * — an object-storage REFERENCE only, never a public URL, and never a
 * credential or password. `assertNoCredentialShapedKey` mirrors the
 * database's own `document_references_no_credential_shaped_key` CHECK
 * constraint at the application layer, so a bad key is refused before an
 * insert is even attempted, not just caught by the database afterward.
 */

export const documentTypes = [
  'CONTRACT', 'AMENDMENT', 'RATE_SHEET', 'COMMISSION_SCHEDULE', 'CANCELLATION_POLICY',
  'SUPPLIER_ONBOARDING_FORM', 'ACCREDITATION', 'INSURANCE_CERTIFICATE', 'IATA_CONSOLIDATOR_DOCUMENT',
  'BANK_DETAILS', 'TAX_DOCUMENT', 'LEGAL_DOCUMENT'
] as const;
export type DocumentType = (typeof documentTypes)[number];

export const documentClassifications = ['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
export type DocumentClassification = (typeof documentClassifications)[number];

export const documentReviewStatuses = ['PENDING_REVIEW', 'REVIEWED', 'FLAGGED', 'EXPIRED'] as const;
export type DocumentReviewStatus = (typeof documentReviewStatuses)[number];

const CREDENTIAL_SHAPED_KEY_PATTERN = /(password|passwd|secret|api[_-]?key)/i;
const PUBLIC_URL_PATTERN = /^https?:\/\//i;

export const documentReferenceSchema = z.object({
  documentId: z.uuid(),
  subjectType: z.string().min(1),
  subjectId: z.uuid(),
  documentType: z.enum(documentTypes),
  objectStorageKey: z.string().min(1).refine((key) => !CREDENTIAL_SHAPED_KEY_PATTERN.test(key), { message: 'object storage key must not look like a credential' })
    .refine((key) => !PUBLIC_URL_PATTERN.test(key), { message: 'object storage key must be a private reference, never a public URL' }),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.number().int().positive(),
  classification: z.enum(documentClassifications),
  retentionStatus: z.string(),
  accessControl: z.record(z.string(), z.unknown()),
  uploadedBy: z.uuid(),
  reviewStatus: z.enum(documentReviewStatuses),
  expiryAlertAt: z.iso.datetime().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict();
export type DocumentReference = z.infer<typeof documentReferenceSchema>;

export class DocumentAuthorityError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'CREDENTIAL_SHAPED_KEY' | 'PUBLIC_URL_REJECTED') {
    super(message);
    this.name = 'DocumentAuthorityError';
  }
}

export interface DocumentStore {
  saveDocument(doc: DocumentReference): Promise<void>;
  loadDocument(documentId: string): Promise<DocumentReference | null>;
  recordDocumentEvent(event: { eventId: string; documentId: string; kind: string; actorId: string; actorKind: 'human' | 'agent' | 'system'; correlationId: string; reasonCode?: string | null }): Promise<void>;
}

export class InMemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, DocumentReference>();
  private readonly events: Array<{ eventId: string; documentId: string; kind: string; actorId: string; actorKind: string; correlationId: string; reasonCode?: string | null }> = [];

  async saveDocument(doc: DocumentReference): Promise<void> {
    this.documents.set(doc.documentId, doc);
  }
  async loadDocument(documentId: string): Promise<DocumentReference | null> {
    return this.documents.get(documentId) ?? null;
  }
  async recordDocumentEvent(event: { eventId: string; documentId: string; kind: string; actorId: string; actorKind: 'human' | 'agent' | 'system'; correlationId: string; reasonCode?: string | null }): Promise<void> {
    this.events.push(event);
  }
  eventsFor(documentId: string) {
    return this.events.filter((e) => e.documentId === documentId);
  }
}

export type DocumentServiceContext = { store: DocumentStore; correlationId: string; now: () => Date };

export async function registerDocumentReference(
  ctx: DocumentServiceContext,
  input: Omit<DocumentReference, 'documentId' | 'correlationId' | 'createdAt'>
): Promise<{ documentId: string }> {
  if (CREDENTIAL_SHAPED_KEY_PATTERN.test(input.objectStorageKey)) {
    throw new DocumentAuthorityError('Object storage key must not look like a credential (password/secret/api key).', 'CREDENTIAL_SHAPED_KEY');
  }
  if (PUBLIC_URL_PATTERN.test(input.objectStorageKey)) {
    throw new DocumentAuthorityError('Object storage key must be a private reference, never a public URL.', 'PUBLIC_URL_REJECTED');
  }
  const documentId = randomUUID();
  const doc: DocumentReference = { ...input, documentId, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() };
  const parsed = documentReferenceSchema.safeParse(doc);
  if (!parsed.success) throw new DocumentAuthorityError('Invalid document reference.', 'VALIDATION');

  await ctx.store.saveDocument(doc);
  await ctx.store.recordDocumentEvent({ eventId: randomUUID(), documentId, kind: 'DOCUMENT_REGISTERED', actorId: input.uploadedBy, actorKind: 'human', correlationId: ctx.correlationId });
  return { documentId };
}

export async function markDocumentReviewed(ctx: DocumentServiceContext, documentId: string, reviewedBy: string, status: Exclude<DocumentReviewStatus, 'PENDING_REVIEW'>): Promise<void> {
  const doc = await ctx.store.loadDocument(documentId);
  if (!doc) throw new DocumentAuthorityError('Document not found.', 'NOT_FOUND');
  await ctx.store.saveDocument({ ...doc, reviewStatus: status });
  await ctx.store.recordDocumentEvent({ eventId: randomUUID(), documentId, kind: `DOCUMENT_${status}`, actorId: reviewedBy, actorKind: 'human', correlationId: ctx.correlationId });
}
