import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@/server/bos/canonical-json';
import {
  customerTravelRequestCommandSchema,
  staffTravelRequestCommandSchema,
  travelRequestContentSchema
} from '@/server/travel-request/contract';

const validContent = {
  destination: 'Istanbul',
  departureCity: 'Baku',
  departureDate: '2026-09-10',
  returnDate: '2026-09-17',
  travelers: { adults: 2, children: 0, infants: 0 },
  budgetAzn: 4_500,
  tripPurpose: 'leisure',
  notes: 'Quiet hotel',
  locale: 'az',
  submissionAcknowledgements: {
    accuracyConfirmed: true,
    dataProcessingAcknowledged: true
  }
};

test('Travel Request content validates launch fields and canonical SHA-256 is stable', () => {
  assert.equal(travelRequestContentSchema.safeParse(validContent).success, true);
  assert.equal(
    sha256(validContent),
    sha256({
      tripPurpose: 'leisure',
      notes: 'Quiet hotel',
      locale: 'az',
      returnDate: '2026-09-17',
      departureDate: '2026-09-10',
      budgetAzn: 4_500,
      departureCity: 'Baku',
      destination: 'Istanbul',
      travelers: { infants: 0, children: 0, adults: 2 },
      submissionAcknowledgements: { dataProcessingAcknowledged: true, accuracyConfirmed: true }
    })
  );
});

test('invalid dates, reverse date ranges, excessive budget and unknown fields are rejected', () => {
  assert.equal(travelRequestContentSchema.safeParse({ ...validContent, departureDate: '2026-02-30' }).success, false);
  assert.equal(
    travelRequestContentSchema.safeParse({ ...validContent, departureDate: '2026-09-20', returnDate: '2026-09-10' }).success,
    false
  );
  assert.equal(travelRequestContentSchema.safeParse({ ...validContent, budgetAzn: 1_000_001 }).success, false);
  assert.equal(travelRequestContentSchema.safeParse({ ...validContent, unexpected: 'not accepted' }).success, false);
});

test('draft save permits pending acknowledgements but submission requires both exact confirmations', () => {
  const pendingContent = {
    ...validContent,
    submissionAcknowledgements: { accuracyConfirmed: false, dataProcessingAcknowledged: false }
  };
  assert.equal(
    customerTravelRequestCommandSchema.safeParse({ action: 'travel_request.save_draft', content: pendingContent }).success,
    true
  );
  assert.equal(
    customerTravelRequestCommandSchema.safeParse({ action: 'travel_request.submit', content: pendingContent }).success,
    false
  );
  assert.equal(
    customerTravelRequestCommandSchema.safeParse({ action: 'travel_request.submit', content: validContent }).success,
    true
  );
});

test('staff command contract exposes only claim and the two pre-review transitions', () => {
  const requestId = '40000000-0000-4000-8000-000000000001';
  assert.equal(staffTravelRequestCommandSchema.safeParse({ action: 'travel_request.claim', requestId }).success, true);
  assert.equal(
    staffTravelRequestCommandSchema.safeParse({ action: 'travel_request.start_ai_preparation', requestId }).success,
    true
  );
  assert.equal(
    staffTravelRequestCommandSchema.safeParse({ action: 'travel_request.start_human_review', requestId }).success,
    true
  );
  assert.equal(staffTravelRequestCommandSchema.safeParse({ action: 'quotation.publish', requestId }).success, false);
});
