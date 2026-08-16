import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mapPublishedProposalToJourneyCanvasViewModel } from '@/lib/production-journey-canvas-mapper';
import { deriveJourneyNextAction, deriveBookingStage } from '@/lib/journey-continuity';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function hasRealImportOf(source: string, name: string): boolean {
  const code = stripComments(source);
  return new RegExp(`(^|\\n)\\s*import[^\\n]*\\b${name}\\b[^\\n]*from`, 'm').test(code)
    || new RegExp(`require\\(['"][^'"]*${name}[^'"]*['"]\\)`).test(code)
    || new RegExp(`import\\(['"][^'"]*${name}[^'"]*['"]\\)`).test(code);
}

const BASE_PROPOSAL = {
  id: 'prop-1', quotationId: 'quote-1', versionNumber: 1, payloadHash: 'a'.repeat(64), status: 'ACCEPTED' as const,
  customer: { title: 'Baku to Istanbul' } as any, locale: 'en' as const, validUntil: '2026-12-31T00:00:00.000Z',
  publishedAt: '2026-08-01T00:00:00.000Z', acceptedAt: '2026-08-02T00:00:00.000Z'
};

test('CHARACTERIZATION: production journey-canvas.tsx wraps the real, untouched PublishedProposals component (accept() authority) — locked before any convergence edit', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'PublishedProposals'));
  assert.ok(source.includes('<PublishedProposals'));
});

test('CHARACTERIZATION: production journey-canvas.tsx derives its stage/next-action from real fields via deriveJourneyNextAction — locked', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'deriveJourneyNextAction'));
  assert.ok(source.includes('deriveJourneyNextAction(acceptedProposal, payments, bookings)'));
});

test('CHARACTERIZATION: production journey-canvas.tsx renders NextActionCard, not a reimplementation of its status logic — locked', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'NextActionCard'));
});

test('mapPublishedProposalToJourneyCanvasViewModel performs no write, imports no Supabase/admin client, calls no fetch', async () => {
  const source = await readSource('src/lib/production-journey-canvas-mapper.ts');
  assert.ok(!hasRealImportOf(source, 'supabase'));
  assert.ok(!hasRealImportOf(source, 'createAdminSupabaseClient'));
  assert.ok(!source.includes('fetch('));
});

test('mapPublishedProposalToJourneyCanvasViewModel imports zero E.2B preview fixtures or the deterministic preview engine', async () => {
  const source = await readSource('src/lib/production-journey-canvas-mapper.ts');
  assert.ok(!hasRealImportOf(source, 'e2b-experience-preview-fixtures'));
  assert.ok(!hasRealImportOf(source, 'e2b-conversation-engine'));
});

test('mapPublishedProposalToJourneyCanvasViewModel never derives authority itself — no local reimplementation of deriveJourneyNextAction/deriveBookingStage', async () => {
  const source = await readSource('src/lib/production-journey-canvas-mapper.ts');
  assert.ok(!source.includes('function deriveJourneyNextAction'));
  assert.ok(!source.includes('function deriveBookingStage'));
});

test('mapPublishedProposalToJourneyCanvasViewModel always produces evidenceMode LIVE', () => {
  const result = mapPublishedProposalToJourneyCanvasViewModel({
    proposal: BASE_PROPOSAL, payment: null, booking: null,
    nextAction: deriveJourneyNextAction(BASE_PROPOSAL, [], []),
    labels: { heading: 'fallback', summary: '', mapUnavailable: 'unavailable' }
  });
  assert.equal(result.evidenceMode, 'LIVE');
});

test('mapPublishedProposalToJourneyCanvasViewModel omits hotel/dining/experience/itinerary/compare fields — never fabricates them from a contract that does not supply them', () => {
  const result = mapPublishedProposalToJourneyCanvasViewModel({
    proposal: BASE_PROPOSAL, payment: null, booking: null,
    nextAction: deriveJourneyNextAction(BASE_PROPOSAL, [], []),
    labels: { heading: 'fallback', summary: '', mapUnavailable: 'unavailable' }
  });
  assert.equal(result.hotelCandidate, undefined);
  assert.equal(result.diningCandidate, undefined);
  assert.equal(result.experienceCards, undefined);
  assert.equal(result.days, undefined);
  assert.equal(result.compareOptions, undefined);
  assert.equal(result.routeLabel, null);
});

test('mapPublishedProposalToJourneyCanvasViewModel uses the real proposal title when present, falls back to a label only when absent', () => {
  const withTitle = mapPublishedProposalToJourneyCanvasViewModel({
    proposal: BASE_PROPOSAL, payment: null, booking: null, nextAction: deriveJourneyNextAction(BASE_PROPOSAL, [], []),
    labels: { heading: 'fallback', summary: '', mapUnavailable: 'unavailable' }
  });
  assert.equal(withTitle.heading, 'Baku to Istanbul');

  const withoutTitle = mapPublishedProposalToJourneyCanvasViewModel({
    proposal: { ...BASE_PROPOSAL, customer: {} as any }, payment: null, booking: null,
    nextAction: deriveJourneyNextAction(BASE_PROPOSAL, [], []),
    labels: { heading: 'fallback-title', summary: '', mapUnavailable: 'unavailable' }
  });
  assert.equal(withoutTitle.heading, 'fallback-title');
});

const PROPOSAL_ACCEPTED = { quotationId: 'q1', status: 'ACCEPTED' };
const PROPOSAL_NOT_ACCEPTED = { quotationId: 'q1', status: 'PUBLISHED' };

test('1/20: no payment request after acceptance never shows pay-now', () => {
  const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [], []);
  assert.equal(action.stageKey, 'awaitingPayment');
  assert.equal(action.responsibility, 'voyara');
  assert.equal(action.primaryAction, null);
});

test('2/20 + 3/20: REQUESTED and EVIDENCE_REJECTED both mean customer action required', () => {
  for (const status of ['REQUESTED', 'EVIDENCE_REJECTED'] as const) {
    const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [{ quotationId: 'q1', id: 'pay1', status }], []);
    assert.equal(action.stageKey, 'paymentActionRequired');
    assert.equal(action.responsibility, 'customer');
    assert.equal(action.primaryAction, 'continueToPayment');
  }
});

test('4/20 + 5/20: EVIDENCE_RECEIVED and UNDER_REVIEW both mean VOYARA owns the next step', () => {
  for (const status of ['EVIDENCE_RECEIVED', 'UNDER_REVIEW'] as const) {
    const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [{ quotationId: 'q1', id: 'pay1', status }], []);
    assert.equal(action.stageKey, 'paymentInReview');
    assert.equal(action.responsibility, 'voyara');
  }
});

test('6/20 + 7/20 + 8/20: VERIFIED, ALLOCATED, READY_FOR_BOOKING never re-request payment', () => {
  for (const status of ['VERIFIED', 'ALLOCATED', 'READY_FOR_BOOKING'] as const) {
    const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [{ quotationId: 'q1', id: 'pay1', status }], []);
    assert.equal(action.stageKey, 'awaitingBooking');
    assert.notEqual(action.primaryAction, 'continueToPayment');
  }
});

test('9/20: a real matching CREATED booking displays only its evidenced stage', () => {
  const action = deriveJourneyNextAction(
    PROPOSAL_ACCEPTED, [{ quotationId: 'q1', id: 'pay1', status: 'READY_FOR_BOOKING' }],
    [{ quotationId: 'q1', id: 'book1', status: 'CREATED' }]
  );
  assert.equal(action.stageKey, 'bookingInProgress');
});

test('10/20-13/20: SUPPLIER_EXECUTED, SUPPLIER_CONFIRMED, UNDER_VERIFICATION, BOOKING_VERIFIED all remain bookingInProgress — none silently imply readiness', () => {
  for (const status of ['SUPPLIER_EXECUTED', 'SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION', 'BOOKING_VERIFIED'] as const) {
    const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [], [{ quotationId: 'q1', id: 'book1', status }]);
    assert.equal(action.stageKey, 'bookingInProgress', `${status} must not fabricate readiness`);
    const bookingStage = deriveBookingStage(status);
    assert.equal(bookingStage.stageKey, 'bookingInProgress');
  }
});

test('14/20: VOUCHER_ISSUED alone reaches ready-to-travel', () => {
  const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [], [{ quotationId: 'q1', id: 'book1', status: 'VOUCHER_ISSUED' }]);
  assert.equal(action.stageKey, 'readyToTravel');
  assert.equal(action.responsibility, 'ready');
  assert.equal(action.primaryAction, 'openTripRoom');
  const bookingStage = deriveBookingStage('VOUCHER_ISSUED');
  assert.equal(bookingStage.stageKey, 'readyToTravel');
});

test('15/20: VERIFICATION_REJECTED never reaches ready-to-travel', () => {
  const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [], [{ quotationId: 'q1', id: 'book1', status: 'VERIFICATION_REJECTED' }]);
  assert.notEqual(action.stageKey, 'readyToTravel');
  assert.equal(action.stageKey, 'bookingInProgress');
});

test('16/20: a payment with a DIFFERENT quotationId has zero effect', () => {
  const action = deriveJourneyNextAction(PROPOSAL_ACCEPTED, [{ quotationId: 'OTHER-QUOTE', id: 'pay1', status: 'REQUESTED' }], []);
  assert.equal(action.stageKey, 'awaitingPayment');
});

test('17/20: a booking with a DIFFERENT quotationId has zero effect', () => {
  const action = deriveJourneyNextAction(
    PROPOSAL_ACCEPTED, [{ quotationId: 'q1', id: 'pay1', status: 'READY_FOR_BOOKING' }],
    [{ quotationId: 'OTHER-QUOTE', id: 'book1', status: 'VOUCHER_ISSUED' }]
  );
  assert.equal(action.stageKey, 'awaitingBooking');
});

test('18/20 + 19/20: a non-ACCEPTED proposal never fabricates payment/booking progress, even with unrelated real rows present', () => {
  const action = deriveJourneyNextAction(PROPOSAL_NOT_ACCEPTED, [{ quotationId: 'q1', id: 'pay1', status: 'READY_FOR_BOOKING' }], [{ quotationId: 'q1', id: 'book1', status: 'VOUCHER_ISSUED' }]);
  assert.equal(action.stageKey, 'notAccepted');
});

test('20/20: the mapper never authors its own stageKey/responsibility — both come from the untouched nextAction object', async () => {
  const source = await readSource('src/lib/production-journey-canvas-mapper.ts');
  assert.ok(!source.includes('stageKey:'));
  assert.ok(!source.includes('responsibility:'));
});
