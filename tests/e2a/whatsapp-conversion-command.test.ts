import assert from 'node:assert/strict';
import test from 'node:test';
import { whatsappConversionInputSchema } from '@/server/whatsapp/whatsapp-conversion-command';

/**
 * E.2A §6 — wrapper-level tests that don't require a live Supabase
 * connection (those live in the migration-29 database suite, which
 * exercises the real RPC directly). These prove the INPUT boundary: the
 * schema structurally cannot carry actor/session/AAL/account/customer/
 * brand/hash/idempotency-hash fields at all, so no amount of forged
 * request data can inject them — there is no field for an attacker to
 * even attempt to set.
 */

test('the input schema has no field for actorId, sessionId, AAL, account, customer, or brand — structurally impossible to forge', () => {
  const shape = Object.keys(whatsappConversionInputSchema.shape);
  const forbidden = ['actorId', 'sessionId', 'aal', 'assuranceLevel', 'accountId', 'customerId', 'brand', 'customerFacingBrand'];
  for (const field of forbidden) {
    assert.ok(!shape.includes(field), `input schema must not accept ${field} from the caller`);
  }
});

test('the input schema has no field for message hashes or the idempotency payload hash — both are always server-computed', () => {
  const shape = Object.keys(whatsappConversionInputSchema.shape);
  const forbidden = ['acknowledgementContentHash', 'confirmationContentHash', 'contentHash', 'idempotencyPayloadHash', 'payloadHash'];
  for (const field of forbidden) {
    assert.ok(!shape.includes(field), `input schema must not accept ${field} from the caller`);
  }
});

test('the input schema has no field for provider timestamp — always derived from the stored message row', () => {
  const shape = Object.keys(whatsappConversionInputSchema.shape);
  assert.ok(!shape.includes('providerOccurredAt'));
  assert.ok(!shape.includes('acknowledgementTimestamp'));
});

test('disclosure version is restricted to the known approved set, rejecting an arbitrary string', () => {
  const base = {
    conversationId: '11111111-1111-4111-8111-111111111111',
    confirmationRequestMessageId: '22222222-2222-4222-8222-222222222222',
    acknowledgementMessageId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'a-valid-idempotency-key-123',
    content: {
      destination: 'Baku', departureCity: 'Istanbul', departureDate: '2026-09-01', returnDate: '2026-09-05',
      travelers: { adults: 2, children: 0, infants: 0 }, budgetAzn: 3000, tripPurpose: 'leisure', notes: '', locale: 'az',
      submissionAcknowledgements: { accuracyConfirmed: true, dataProcessingAcknowledged: true }
    }
  };
  const valid = whatsappConversionInputSchema.safeParse({ ...base, disclosureVersion: 'E2A_AZ_V1' });
  assert.equal(valid.success, true, JSON.stringify(valid.success ? null : valid.error.issues));
  const invalid = whatsappConversionInputSchema.safeParse({ ...base, disclosureVersion: 'ARBITRARY_STRING' });
  assert.equal(invalid.success, false);
});

test('the schema is .strict() — an attacker cannot smuggle an extra field through even if it matched a server-side variable name', () => {
  const result = whatsappConversionInputSchema.safeParse({
    conversationId: '11111111-1111-4111-8111-111111111111',
    confirmationRequestMessageId: '22222222-2222-4222-8222-222222222222',
    acknowledgementMessageId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'a-valid-idempotency-key-123',
    disclosureVersion: 'E2A_AZ_V1',
    content: {
      destination: 'Baku', departureCity: 'Istanbul', departureDate: '2026-09-01', returnDate: '2026-09-05',
      travelers: { adults: 2, children: 0, infants: 0 }, budgetAzn: 3000, tripPurpose: 'leisure', notes: '', locale: 'az',
      submissionAcknowledgements: { accuracyConfirmed: true, dataProcessingAcknowledged: true }
    },
    actorId: 'forged-actor-id',
    assuranceLevel: 'aal2'
  });
  assert.equal(result.success, false, 'strict schema must reject unknown fields outright, not silently drop them');
});

/* ---------------- expanded authority-boundary tests ---------------- */

const VALID_INPUT = {
  conversationId: '11111111-1111-4111-8111-111111111111',
  confirmationRequestMessageId: '22222222-2222-4222-8222-222222222222',
  acknowledgementMessageId: '33333333-3333-4333-8333-333333333333',
  idempotencyKey: 'a-valid-idempotency-key-123',
  disclosureVersion: 'E2A_AZ_V1' as const,
  content: {
    destination: 'Baku', departureCity: 'Istanbul', departureDate: '2026-09-01', returnDate: '2026-09-05',
    travelers: { adults: 2, children: 0, infants: 0 }, budgetAzn: 3000, tripPurpose: 'leisure' as const, notes: '', locale: 'az' as const,
    submissionAcknowledgements: { accuracyConfirmed: true, dataProcessingAcknowledged: true }
  }
};

import type { AppRole } from '@/server/auth/roles';

function viewer(overrides: Partial<{ id: string; roles: AppRole[]; assuranceLevel: string; sessionId: string; issuedAt: number }> = {}) {
  return {
    id: overrides.id ?? '44444444-4444-4444-8444-444444444444',
    roles: overrides.roles ?? (['staff'] as AppRole[]),
    source: 'demo' as const,
    assuranceLevel: (overrides.assuranceLevel ?? 'aal2') as 'aal1' | 'aal2',
    sessionId: overrides.sessionId ?? '55555555-5555-4555-8555-555555555555',
    issuedAt: overrides.issuedAt ?? Math.floor(Date.now() / 1000)
  };
}

test('unauthenticated-equivalent (no staff role) viewer is denied before any Supabase/RPC attempt', async () => {
  const { executeWhatsAppConversionCommand } = await import('@/server/whatsapp/whatsapp-conversion-command');
  const result = await executeWhatsAppConversionCommand(viewer({ roles: ['customer'] }), VALID_INPUT);
  assert.deepEqual(result, { status: 'denied', reasonCode: 'STAFF_REQUIRED' });
});

test('AAL1 staff is denied before any Supabase/RPC attempt', async () => {
  const { executeWhatsAppConversionCommand } = await import('@/server/whatsapp/whatsapp-conversion-command');
  const result = await executeWhatsAppConversionCommand(viewer({ assuranceLevel: 'aal1' }), VALID_INPUT);
  assert.deepEqual(result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });
});

test('a role with no staff-equivalent membership at all is denied', async () => {
  const { executeWhatsAppConversionCommand } = await import('@/server/whatsapp/whatsapp-conversion-command');
  const result = await executeWhatsAppConversionCommand(viewer({ roles: [] }), VALID_INPUT);
  assert.deepEqual(result, { status: 'denied', reasonCode: 'STAFF_REQUIRED' });
});

test('malformed business input (invalid UUID) is denied before any Supabase/RPC attempt, even for a valid AAL2 staff viewer', async () => {
  const { executeWhatsAppConversionCommand } = await import('@/server/whatsapp/whatsapp-conversion-command');
  const result = await executeWhatsAppConversionCommand(viewer(), { ...VALID_INPUT, conversationId: 'not-a-uuid' });
  assert.deepEqual(result, { status: 'denied', reasonCode: 'INVALID_INPUT' });
});

test('a valid AAL2 staff viewer with valid input genuinely reaches the admin-client construction step (proven by the real CONFIGURATION_UNAVAILABLE outcome in this unconfigured test environment — never reached by the denied cases above)', async () => {
  const { executeWhatsAppConversionCommand } = await import('@/server/whatsapp/whatsapp-conversion-command');
  const result = await executeWhatsAppConversionCommand(viewer(), VALID_INPUT);
  // This environment has no real Supabase configured, so a viewer that
  // legitimately passes every authority check still can't complete a
  // real conversion — but reaching CONFIGURATION_UNAVAILABLE (rather than
  // STAFF_REQUIRED/AAL2_REQUIRED/INVALID_INPUT) is itself the proof that
  // authority checks were satisfied and the function proceeded to the
  // admin-client step, exactly where the real RPC call would happen.
  assert.deepEqual(result, { status: 'denied', reasonCode: 'CONFIGURATION_UNAVAILABLE' });
});

for (const role of ['manager', 'admin', 'founder'] as AppRole[]) {
  test(`the "${role}" role is also accepted as staff-equivalent (reaches the admin-client step, same as "staff")`, async () => {
    const { executeWhatsAppConversionCommand } = await import('@/server/whatsapp/whatsapp-conversion-command');
    const result = await executeWhatsAppConversionCommand(viewer({ roles: [role] }), VALID_INPUT);
    assert.deepEqual(result, { status: 'denied', reasonCode: 'CONFIGURATION_UNAVAILABLE' });
  });
}

test('the RPC call maps all 15 parameters by exact name (source-level proof — the real invocation is exercised end-to-end by the migration-29 database suite)', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../../src/server/whatsapp/whatsapp-conversion-command.ts', import.meta.url), 'utf8'
  );
  const expectedParams = [
    'p_command_id', 'p_idempotency_key', 'p_actor_id', 'p_actor_session_id', 'p_actor_aal', 'p_actor_issued_at',
    'p_conversation_id', 'p_confirmation_request_message_id', 'p_acknowledgement_message_id', 'p_acknowledgement_content_hash',
    'p_disclosure_version', 'p_content', 'p_content_hash', 'p_idempotency_payload_hash', 'p_correlation_id'
  ];
  for (const param of expectedParams) {
    assert.ok(source.includes(`${param}:`), `RPC call includes named parameter ${param}`);
  }
});

test('a malformed RPC response (fails Zod validation) is mapped to a controlled denial, source-level proof of the fail-closed path', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../../src/server/whatsapp/whatsapp-conversion-command.ts', import.meta.url), 'utf8'
  );
  assert.ok(source.includes('rpcResultSchema.safeParse(data)'));
  assert.ok(source.includes("reasonCode: 'MALFORMED_RESPONSE'"));
});

test('an RPC transport error is mapped to a controlled denial without exposing internal SQL/Postgres details', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../../src/server/whatsapp/whatsapp-conversion-command.ts', import.meta.url), 'utf8'
  );
  assert.ok(source.includes('if (error) {'));
  assert.ok(source.includes("reasonCode: 'DATABASE_ERROR'"));
  assert.ok(!/error\.message|error\.details|error\.hint/.test(source), 'never forwards raw Postgres error text to the caller');
});
