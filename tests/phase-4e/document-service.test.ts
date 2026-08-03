import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { registerDocumentReference, markDocumentReviewed, InMemoryDocumentStore, DocumentAuthorityError, documentTypes, type DocumentServiceContext, type DocumentReference } from '@/server/agents/supplier-ops/document-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): DocumentServiceContext & { store: InMemoryDocumentStore } {
  return { store: new InMemoryDocumentStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function baseInput(overrides: Partial<Omit<DocumentReference, 'documentId' | 'correlationId' | 'createdAt'>> = {}) {
  return {
    subjectType: 'contract', subjectId: randomUUID(), documentType: 'CONTRACT' as const,
    objectStorageKey: 'private/contracts/rtravel-hotel-wholesaler-2026.pdf', checksum: 'a'.repeat(64),
    version: 1, classification: 'CONFIDENTIAL' as const, retentionStatus: 'ACTIVE', accessControl: {},
    uploadedBy: randomUUID(), reviewStatus: 'PENDING_REVIEW' as const, expiryAlertAt: null,
    ...overrides
  };
}

test('registering a real private document reference succeeds', async () => {
  const c = ctx();
  const { documentId } = await registerDocumentReference(c, baseInput());
  const doc = await c.store.loadDocument(documentId);
  assert.equal(doc?.reviewStatus, 'PENDING_REVIEW');
});

test('a credential-shaped object storage key is refused', async () => {
  const c = ctx();
  await assert.rejects(
    () => registerDocumentReference(c, baseInput({ objectStorageKey: 'private/supplier-portal-password.txt' })),
    (e: unknown) => e instanceof DocumentAuthorityError && e.code === 'CREDENTIAL_SHAPED_KEY'
  );
});

test('an API-key-shaped object storage key is refused', async () => {
  const c = ctx();
  await assert.rejects(
    () => registerDocumentReference(c, baseInput({ objectStorageKey: 'private/hotel-supplier-api-key.txt' })),
    (e: unknown) => e instanceof DocumentAuthorityError && e.code === 'CREDENTIAL_SHAPED_KEY'
  );
});

test('a public URL is refused as an object storage key', async () => {
  const c = ctx();
  await assert.rejects(
    () => registerDocumentReference(c, baseInput({ objectStorageKey: 'https://public-bucket.example.com/contract.pdf' })),
    (e: unknown) => e instanceof DocumentAuthorityError && e.code === 'PUBLIC_URL_REJECTED'
  );
});

test('marking a document reviewed records an immutable event with the real reviewer', async () => {
  const c = ctx();
  const { documentId } = await registerDocumentReference(c, baseInput());
  const reviewer = randomUUID();
  await markDocumentReviewed(c, documentId, reviewer, 'REVIEWED');
  const doc = await c.store.loadDocument(documentId);
  assert.equal(doc?.reviewStatus, 'REVIEWED');
  const events = c.store.eventsFor(documentId);
  assert.ok(events.some((e) => e.kind === 'DOCUMENT_REVIEWED' && e.actorId === reviewer));
  assert.ok(events.some((e) => e.kind === 'DOCUMENT_REGISTERED'));
});

test('every document type in the closed enum is one of the founder-listed categories', () => {
  const expected = [
    'CONTRACT', 'AMENDMENT', 'RATE_SHEET', 'COMMISSION_SCHEDULE', 'CANCELLATION_POLICY',
    'SUPPLIER_ONBOARDING_FORM', 'ACCREDITATION', 'INSURANCE_CERTIFICATE', 'IATA_CONSOLIDATOR_DOCUMENT',
    'BANK_DETAILS', 'TAX_DOCUMENT', 'LEGAL_DOCUMENT'
  ];
  assert.deepEqual([...documentTypes].sort(), expected.sort());
});
