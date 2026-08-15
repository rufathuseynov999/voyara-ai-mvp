import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyUniqueViolation,
  ACTIVE_CONVERSATION_CONSTRAINT_NAME,
  MESSAGE_REPLAY_CONSTRAINT_NAME
} from '@/server/conversation/conversation-store-errors';

/**
 * These error shapes are not invented — they were verified directly
 * against a real Postgres engine (PGlite) during development: a genuine
 * unique-violation on a named index produces exactly
 * { code: '23505', constraint: '<index name>', message: 'duplicate key
 * value violates unique constraint "<index name>"', details: 'Key (...)=
 * (...) already exists.' }.
 */

test('classifies the exact active-conversation constraint via the structured constraint field', () => {
  const result = classifyUniqueViolation({ code: '23505', constraint: ACTIVE_CONVERSATION_CONSTRAINT_NAME, message: `duplicate key value violates unique constraint "${ACTIVE_CONVERSATION_CONSTRAINT_NAME}"` });
  assert.equal(result, 'ACTIVE_CONVERSATION');
});

test('classifies the exact message-replay constraint via the structured constraint field', () => {
  const result = classifyUniqueViolation({ code: '23505', constraint: MESSAGE_REPLAY_CONSTRAINT_NAME, message: `duplicate key value violates unique constraint "${MESSAGE_REPLAY_CONSTRAINT_NAME}"` });
  assert.equal(result, 'MESSAGE_REPLAY');
});

test('classifies via message/details fallback when the structured constraint field is absent', () => {
  const result = classifyUniqueViolation({ code: '23505', message: `duplicate key value violates unique constraint "${ACTIVE_CONVERSATION_CONSTRAINT_NAME}"` });
  assert.equal(result, 'ACTIVE_CONVERSATION');
});

test('classifies via details field when message alone does not carry the constraint name', () => {
  const result = classifyUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint', details: `Key already exists in "${MESSAGE_REPLAY_CONSTRAINT_NAME}".` });
  assert.equal(result, 'MESSAGE_REPLAY');
});

test('an unrelated 23505 (e.g. the primary key, or any other real constraint) is UNKNOWN, never guessed as one of the two known conflicts', () => {
  const result = classifyUniqueViolation({ code: '23505', constraint: 'messages_pkey', message: 'duplicate key value violates unique constraint "messages_pkey"' });
  assert.equal(result, 'UNKNOWN');
});

test('a 23505 with missing/absent constraint metadata and no matching text is UNKNOWN, never assumed recoverable', () => {
  const result = classifyUniqueViolation({ code: '23505' });
  assert.equal(result, 'UNKNOWN');
});

test('a non-23505 error is always UNKNOWN regardless of any text similarity to a known constraint name', () => {
  const result = classifyUniqueViolation({ code: '23503', message: `foreign key violation, unrelated to "${ACTIVE_CONVERSATION_CONSTRAINT_NAME}" mentioned only incidentally` });
  assert.equal(result, 'UNKNOWN');
});

test('null/undefined error input is UNKNOWN', () => {
  assert.equal(classifyUniqueViolation(null), 'UNKNOWN');
  assert.equal(classifyUniqueViolation(undefined), 'UNKNOWN');
});

test('never classifies every 23505 as recoverable — a real 23505 on an unrelated, differently-named constraint stays UNKNOWN even with matching message boilerplate', () => {
  const result = classifyUniqueViolation({
    code: '23505',
    constraint: 'contacts_phone_uidx',
    message: 'duplicate key value violates unique constraint "contacts_phone_uidx"'
  });
  assert.equal(result, 'UNKNOWN');
});

/* -------------------- production PostgrestError shape (verified, not assumed) -------------------- */
/* @supabase/postgrest-js's PostgrestError (the ACTUAL type every Supabase
 * call in this codebase throws) is exactly { message, details, hint,
 * code } — confirmed directly from
 * node_modules/@supabase/postgrest-js/src/PostgrestError.ts. There is NO
 * `constraint` field in production. These tests use exactly that shape,
 * with `hint: null` matching Supabase's real behavior for a plain unique
 * violation (no fix suggestion available). */

function productionError(overrides: { code?: string; message?: string; details?: string; hint?: string | null }) {
  return { code: overrides.code ?? '23505', details: overrides.details ?? '', hint: overrides.hint ?? null, message: overrides.message ?? '' };
}

test('production shape: exact active-conversation constraint classifies correctly with no constraint field present', () => {
  const err = productionError({ message: `duplicate key value violates unique constraint "${ACTIVE_CONVERSATION_CONSTRAINT_NAME}"`, details: 'Key (account_id, contact_id, customer_facing_brand)=(...) already exists.' });
  assert.equal(classifyUniqueViolation(err), 'ACTIVE_CONVERSATION');
});

test('production shape: exact external-message-replay constraint classifies correctly', () => {
  const err = productionError({ message: `duplicate key value violates unique constraint "${MESSAGE_REPLAY_CONSTRAINT_NAME}"`, details: 'Key (channel, external_message_id)=(WHATSAPP, wamid.ABC) already exists.' });
  assert.equal(classifyUniqueViolation(err), 'MESSAGE_REPLAY');
});

test('production shape: an unrelated real named constraint remains UNKNOWN', () => {
  const err = productionError({ message: 'duplicate key value violates unique constraint "contacts_phone_uidx"', details: 'Key (phone)=(+994501234567) already exists.' });
  assert.equal(classifyUniqueViolation(err), 'UNKNOWN');
});

test('production shape: a constraint name appearing only inside a longer attacker-controlled string does not falsely match', () => {
  // An attacker-influenced value (e.g. a customer-typed note) could
  // theoretically contain text resembling a constraint name without
  // quotes, or with extra characters — the anchored, quoted match must
  // not fire on a near-miss.
  const err = productionError({ message: `some unrelated error mentioning ${ACTIVE_CONVERSATION_CONSTRAINT_NAME}_evil_suffix without quotes` });
  assert.equal(classifyUniqueViolation(err), 'UNKNOWN');
});

test('production shape: a constraint name substring without the exact surrounding quotes does not match', () => {
  const err = productionError({ message: `duplicate key value violates unique constraint ${ACTIVE_CONVERSATION_CONSTRAINT_NAME}` }); // missing quotes entirely
  assert.equal(classifyUniqueViolation(err), 'UNKNOWN');
});

test('production shape: a code other than 23505 remains UNKNOWN even with a matching message', () => {
  const err = productionError({ code: '42501', message: `permission denied, unrelated to "${ACTIVE_CONVERSATION_CONSTRAINT_NAME}"` });
  assert.equal(classifyUniqueViolation(err), 'UNKNOWN');
});

test('production shape: missing message and details (both empty strings, matching real Supabase behavior for some error paths) remains UNKNOWN', () => {
  const err = productionError({ message: '', details: '' });
  assert.equal(classifyUniqueViolation(err), 'UNKNOWN');
});
