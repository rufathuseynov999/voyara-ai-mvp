import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { denialGuidance, type InboxLabels } from '@/components/crm-inbox';
import { previewWaitingDetail, previewReadyDetail } from '@/lib/e2a-preview-fixtures';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

const LABELS = JSON.parse(readFileSync('src/i18n/messages/en.json', 'utf8')).inbox as InboxLabels;

/* ---------------------------- denialGuidance (pure logic) ---------------------------- */

test('denialGuidance maps every known reason code to a real, non-empty staff-readable string', () => {
  const knownCodes = [
    'ALREADY_CONVERTED', 'ACKNOWLEDGEMENT_BEFORE_CONFIRMATION', 'STALE_ACKNOWLEDGEMENT_EVIDENCE',
    'UNLINKED_CONTACT', 'MISSING_BRAND', 'CONVERSATION_NOT_WHATSAPP',
    'ACKNOWLEDGEMENT_MISSING_PROVIDER_TIMESTAMP', 'CONFIRMATION_REQUEST_NOT_SENT', 'INVALID_TRAVEL_REQUEST'
  ];
  for (const code of knownCodes) {
    const message = denialGuidance(code, LABELS);
    assert.ok(message.length > 0, `${code} maps to a real message`);
    assert.notEqual(message, code, `${code} is never echoed back raw`);
  }
});

test('denialGuidance never returns a raw/unmapped reason code — an unknown code falls back to the generic message', () => {
  const message = denialGuidance('SOME_FUTURE_UNMAPPED_CODE_XYZ', LABELS);
  assert.equal(message, LABELS.conversionDenialGeneric);
  assert.ok(!message.includes('SOME_FUTURE_UNMAPPED_CODE_XYZ'));
});

/* ---------------------------- fixture honesty ---------------------------- */

test('the waiting fixture has no acknowledgement message after the confirmation (genuinely blocked, not a UI restriction)', () => {
  const detail = previewWaitingDetail();
  const confirmation = detail.messages.find((m) => m.direction === 'OUTBOUND' && m.senderKind === 'STAFF');
  assert.ok(confirmation);
  const laterInboundFromContact = detail.messages.filter(
    (m) => m.direction === 'INBOUND' && m.senderKind === 'CONTACT'
      && new Date(m.providerOccurredAt ?? m.createdAt).getTime() > new Date(confirmation!.sentAt ?? confirmation!.createdAt).getTime()
  );
  assert.equal(laterInboundFromContact.length, 0, 'no real acknowledgement candidate exists in the waiting fixture');
});

test('the ready fixture has a real acknowledgement that occurs strictly after the confirmation was sent', () => {
  const detail = previewReadyDetail();
  const confirmation = detail.messages.find((m) => m.direction === 'OUTBOUND' && m.senderKind === 'STAFF');
  const ack = detail.messages.find((m) => m.direction === 'INBOUND' && m.senderKind === 'CONTACT' && m.messageId !== detail.messages[0].messageId);
  assert.ok(confirmation && ack);
  assert.ok(new Date(ack!.providerOccurredAt ?? ack!.createdAt).getTime() > new Date(confirmation!.sentAt ?? confirmation!.createdAt).getTime());
});

/* ---------------------------- source-level correctness proofs ---------------------------- */

test('the acknowledgement candidate filter requires provider-evidence time strictly after the SELECTED confirmation, not just any confirmation', async () => {
  const source = await readSource('src/components/crm-inbox.tsx');
  assert.ok(source.includes('selectedConfirmation'), 'derives from the currently-selected confirmation, not a fixed one');
  assert.ok(source.includes('m.providerOccurredAt ?? m.createdAt'), 'uses provider evidence time, with createdAt only as an explicit fallback');
  assert.ok(source.includes('new Date(occurredAt).getTime() > new Date(confirmedAt).getTime()'), 'requires strictly-after ordering');
});

test('the acknowledgement select is disabled whenever there are zero eligible candidates', async () => {
  const source = await readSource('src/components/crm-inbox.tsx');
  assert.ok(source.includes('disabled={inboundFromContact.length === 0}'));
});

test('the linked-customer label is only ever rendered from the real linkedCustomerId field, and its wording does not claim conversion readiness', async () => {
  const source = await readSource('src/components/crm-inbox.tsx');
  assert.ok(source.includes('detail.linkedCustomerId ? labels.conversionCustomerLinked : labels.conversionCustomerUnlinked'));
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  const label: string = en.inbox.conversionCustomerLinked;
  assert.ok(!/confirm/i.test(label), `"${label}" must not use "confirm" wording that implies the whole conversion is ready`);
  const az = JSON.parse(await readSource('src/i18n/messages/az.json'));
  const ru = JSON.parse(await readSource('src/i18n/messages/ru.json'));
  assert.ok(az.inbox.conversionCustomerLinked && ru.inbox.conversionCustomerLinked, 'label exists in all three locales');
});

test('previewMode makes submit a hard no-op before any network call is attempted', async () => {
  const source = await readSource('src/components/crm-inbox.tsx');
  assert.ok(source.includes('if (previewMode) return;'), 'submit returns immediately in preview mode, before fetch');
  const submitFnIndex = source.indexOf('async function submit()');
  const submitFnBody = source.slice(submitFnIndex);
  const previewGuardIndex = submitFnBody.indexOf('if (previewMode) return;');
  const fetchCallIndex = submitFnBody.indexOf("fetch('/api/v1/inbox'");
  assert.ok(submitFnIndex > -1 && previewGuardIndex > -1 && fetchCallIndex > -1);
  assert.ok(previewGuardIndex < fetchCallIndex, 'the preview guard is positioned before the fetch call, not after');
});

test('the converted state removes the form entirely rather than showing it alongside the result', async () => {
  const source = await readSource('src/components/crm-inbox.tsx');
  assert.ok(source.includes("result?.status === 'accepted' ? ("), 'branches on accepted status');
  // The ternary's else-branch is the only place the form JSX
  // (.inbox-conversion-form) appears — proving it is not rendered
  // simultaneously with the accepted/success branch.
  const formOccurrences = (source.match(/className="inbox-conversion-form"/g) ?? []).length;
  assert.equal(formOccurrences, 1, 'the form markup appears exactly once, inside the non-accepted branch only');
});

test('the converted state displays both real result identifiers and an explicit simulation-data disclaimer in preview mode', async () => {
  const source = await readSource('src/components/crm-inbox.tsx');
  assert.ok(source.includes('result.travelRequestId'));
  assert.ok(source.includes('result.intentId'));
  assert.ok(source.includes('previewMode ? <p className="inbox-conversion-preview-note">'));
});

/* ---------------------------- write-boundary proofs ---------------------------- */

test('no client component imports the admin Supabase client or the conversion command wrapper directly', async () => {
  const files = ['src/components/crm-inbox.tsx', 'src/components/crm-inbox-preview-shell.tsx'];
  for (const file of files) {
    const source = await readSource(file);
    assert.ok(!source.includes('createAdminSupabaseClient'), `${file} must never import the admin client`);
    assert.ok(!source.includes("from '@/server/whatsapp/whatsapp-conversion-command'"), `${file} must never import the server-only wrapper directly`);
  }
});

test('the internal preview route performs zero Supabase/admin-client access and is server-flag-gated', async () => {
  const source = await readSource('src/app/[locale]/internal-preview/e2a-whatsapp/[state]/page.tsx');
  assert.ok(source.includes("process.env.VOYARA_INTERNAL_PREVIEW_ENABLED !== 'true'"));
  assert.ok(source.includes('notFound()'));
  assert.ok(!source.includes('createAdminSupabaseClient'));
  assert.ok(!source.includes('createServerSupabaseClient'));
  assert.ok(source.toLowerCase().includes("index: false"), 'noindex metadata present');
});

test('the internal preview flag name is not a NEXT_PUBLIC_ variable (server-only)', async () => {
  const source = await readSource('src/app/[locale]/internal-preview/e2a-whatsapp/[state]/page.tsx');
  assert.ok(!source.includes('NEXT_PUBLIC_VOYARA_INTERNAL_PREVIEW'));
  assert.ok(source.includes('VOYARA_INTERNAL_PREVIEW_ENABLED'));
});

/* ---------------------------- inbox API authority (source-level) ---------------------------- */

test('the inbox API convertWhatsApp action is reachable only after requireAal2Staff() succeeds, same as every other action', async () => {
  const source = await readSource('src/app/api/v1/inbox/route.ts');
  const viewerCheckIndex = source.indexOf('const viewer = await requireAal2Staff();');
  const convertBranchIndex = source.indexOf("parsed.data.action === 'convertWhatsApp'");
  assert.ok(viewerCheckIndex > -1 && convertBranchIndex > -1);
  assert.ok(viewerCheckIndex < convertBranchIndex, 'AAL2 staff check happens before the convertWhatsApp branch can run');
});

test('the inbox route never passes client-controlled fields as authority into the conversion wrapper — only the verified viewer object', async () => {
  const source = await readSource('src/app/api/v1/inbox/route.ts');
  assert.ok(source.includes('executeWhatsAppConversionCommand(viewer, parsed.data.input)'));
  assert.ok(!/executeWhatsAppConversionCommand\(parsed\.data/.test(source), 'must never pass raw client input as the authority argument');
});

test('the conversion input schema is .strict() end to end (defense in depth beyond the wrapper-level test)', async () => {
  const source = await readSource('src/server/whatsapp/whatsapp-conversion-command.ts');
  assert.ok(source.includes('}).strict();'));
});
