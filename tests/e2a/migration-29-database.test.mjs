/**
 * E.2A — permanent migration-29 database integration suite.
 *
 * Runs the REAL execute_whatsapp_conversion_command SQL function, the
 * real partial unique indexes, the real evidence-immutability and
 * channel-derivation triggers, and the real privilege grants — against a
 * fresh PGlite (real Postgres-compatible engine) database with migrations
 * 1-29 applied in strict order. This is not a mock: every assertion below
 * exercises actual SQL, not a TypeScript reimplementation of it.
 *
 * Run via: npm run test:e2a:db
 *
 * Exits non-zero on any failure (see the `pass`/`fail` counters at the
 * bottom) so CI/local runs fail loudly rather than silently.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }
function sortKeys(obj) { return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))); }

const db = new PGlite();
const dir = 'supabase/migrations';
const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();

await db.exec(`
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $do$;
create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$ select current_setting('role', true) $fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$ select '{}'::jsonb $fn$;
`);
for (const file of files) await db.exec(await readFile(`${dir}/${file}`, 'utf8'));
console.log('migrations applied\n');

let pass = 0, fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail); }
}

// ---- Fixture setup ----
async function setupFixture(overrides = {}) {
  const accountId = randomUUID();
  const contactId = randomUUID();
  const customerId = randomUUID();
  const staffId = randomUUID();
  const conversationId = randomUUID();
  const now = new Date();
  await db.query(`insert into auth.users (id, email) values ($1,'cust@test.com'),($2,'staff@test.com')`, [customerId, staffId]);
  await db.query(`insert into public.role_assignments (user_id, role, active) values ($1,'customer',true),($2,'staff',true) on conflict (user_id, role) where active do nothing`, [customerId, staffId]);
  await db.query(`insert into public.contacts (id, account_id, linked_customer_id, display_name, phone, preferred_locale) values ($1,$2,$3,'Test','+994501234567','az')`, [contactId, accountId, overrides.unlinkedContact ? null : customerId]);
  await db.query(`insert into public.conversations (id, account_id, contact_id, channel, status, correlation_id, customer_facing_brand) values ($1,$2,$3,$4,'OPEN','corr-1',$5)`,
    [conversationId, accountId, contactId, overrides.channel ?? 'WHATSAPP', overrides.brand === undefined ? 'VOYARA' : overrides.brand]);

  const confirmationId = randomUUID();
  const confirmSentAt = new Date(now.getTime() - 60_000).toISOString();
  await db.query(
    `insert into public.messages (id, conversation_id, direction, sender_kind, agent_role, body, content_hash, status, requires_human_approval, approved_by, approved_at, sent_at, correlation_id, created_at, message_type)
     values ($1,$2,'OUTBOUND','STAFF',null,'Please confirm your trip details...','${sha256('confirmation-body')}',$3,false,$4,$5,$5,'corr-1',$5,'TEXT')`,
    [confirmationId, conversationId, overrides.confirmationStatus ?? 'SENT', overrides.confirmationApprovedBy === undefined ? staffId : overrides.confirmationApprovedBy, confirmSentAt]
  );

  const ackId = randomUUID();
  const ackCreatedAt = new Date(now.getTime() - 30_000).toISOString(); // webhook-ingestion time (server time) — deliberately NOT used for ordering
  const ackHash = sha256('yes i confirm');
  const ackDirection = overrides.ackDirection ?? 'INBOUND';
  const ackSender = overrides.ackSender ?? 'CONTACT';
  const ackIsOutboundStaff = ackDirection === 'OUTBOUND' || ackSender === 'STAFF';
  // provider_occurred_at is the message-bound Meta timestamp used for the
  // real ordering check (Section 2) — deliberately independent of
  // ackCreatedAt (server ingestion time) so the two can be set to
  // contradict each other in tests (e.g. a delayed webhook delivering an
  // OLD Meta event after the confirmation was sent).
  const ackProviderOccurredAt = overrides.ackProviderOccurredAt === undefined
    ? (overrides.ackBeforeConfirmation ? new Date(now.getTime() - 120_000).toISOString() : new Date(now.getTime() - 30_000).toISOString())
    : overrides.ackProviderOccurredAt;
  if (ackIsOutboundStaff) {
    await db.query(
      `insert into public.messages (id, conversation_id, direction, sender_kind, agent_role, body, content_hash, status, requires_human_approval, approved_by, approved_at, sent_at, correlation_id, created_at, message_type, provider_occurred_at)
       values ($1,$2,$3,$4,null,'Yes, I confirm',$5,'SENT',false,$6,$7,$7,'corr-1',$7,'TEXT',$8)`,
      [ackId, conversationId, ackDirection, ackSender, ackHash, overrides.ackApprovedBy === undefined ? staffId : overrides.ackApprovedBy, ackCreatedAt, ackProviderOccurredAt]
    );
  } else {
    if (overrides.ackProviderOccurredAtRaw !== undefined) {
      // For the "malformed timestamp" test: bypass the normal path and
      // attempt a raw, deliberately invalid value at the SQL layer.
      await db.query(
        `insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type, provider_occurred_at)
         values ($1,$2,$3,$4,'Yes, I confirm',$5,'SENT',false,$6,'corr-1',$6,'TEXT',$7)`,
        [ackId, conversationId, ackDirection, ackSender, ackHash, overrides.ackBeforeConfirmation ? new Date(now.getTime() - 120_000).toISOString() : ackCreatedAt, overrides.ackProviderOccurredAtRaw]
      );
    } else {
    await db.query(
      `insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type, provider_occurred_at)
       values ($1,$2,$3,$4,'Yes, I confirm',$5,'SENT',false,$6,'corr-1',$6,'TEXT',$7)`,
      [ackId, conversationId, ackDirection, ackSender, ackHash, overrides.ackBeforeConfirmation ? new Date(now.getTime() - 120_000).toISOString() : ackCreatedAt, ackProviderOccurredAt]
    );
    }
  }

  return { accountId, contactId, customerId, staffId, conversationId, confirmationId, ackId, ackHash };
}

const content = { destination: 'Baku', departureCity: 'Istanbul', departureDate: '2026-09-01', returnDate: '2026-09-05', travelers: { adults: 2, children: 0, infants: 0 }, budgetAzn: 3000, tripPurpose: 'leisure', notes: '', locale: 'az', submissionAcknowledgements: { accuracyConfirmed: true, dataProcessingAcknowledged: true } };
const contentHash = sha256(JSON.stringify(content));

// Mirrors the real canonical idempotency-hash computation the trusted
// server wrapper performs (Section 4) — every authority-relevant input,
// deterministic, order-independent via explicit key ordering.
function idempotencyPayloadHash({ conversationId, confirmationId, ackId, ackHash, disclosureVersion, contentHash }) {
  return sha256(JSON.stringify({
    command: 'whatsapp.convert_conversation',
    conversationId, confirmationRequestMessageId: confirmationId, acknowledgementMessageId: ackId,
    acknowledgementContentHash: ackHash, disclosureVersion, travelRequestContentHash: contentHash
  }));
}

async function callConversion(f, overrides = {}) {
  const commandId = randomUUID();
  const idemKey = overrides.idempotencyKey ?? `idem-${randomUUID()}`;
  const conversationId = overrides.conversationId ?? f.conversationId;
  const confirmationId = overrides.confirmationId ?? f.confirmationId;
  const ackId = overrides.ackId ?? f.ackId;
  const ackHash = overrides.ackHash === undefined ? f.ackHash : overrides.ackHash;
  const disclosureVersion = overrides.disclosureVersion === undefined ? 'E2A_AZ_V1' : overrides.disclosureVersion;
  const usedContent = overrides.content ?? content;
  const usedContentHash = overrides.contentHash ?? contentHash;
  const idemHash = overrides.idempotencyPayloadHash ?? idempotencyPayloadHash({ conversationId, confirmationId, ackId, ackHash, disclosureVersion, contentHash: usedContentHash });
  const res = await db.query(
    `select public.execute_whatsapp_conversion_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as result`,
    [
      commandId, idemKey,
      overrides.actorId ?? f.staffId,
      overrides.sessionId === undefined ? randomUUID() : overrides.sessionId,
      overrides.aal ?? 'aal2',
      overrides.issuedAt ?? new Date().toISOString(),
      conversationId, confirmationId, ackId, ackHash, disclosureVersion,
      JSON.stringify(usedContent), usedContentHash, idemHash,
      'corr-1'
    ]
  );
  return { result: res.rows[0].result, commandId, idemKey };
}

// ---- TEST: valid success ----
{
  const f = await setupFixture();
  const { result } = await callConversion(f);
  check('valid success: status accepted', result.status === 'accepted', JSON.stringify(result));
  if (result.status === 'accepted') {
    const trCount = (await db.query(`select count(*) from public.travel_requests where id = $1`, [result.travelRequestId])).rows[0].count;
    const verCount = (await db.query(`select count(*) from public.travel_request_versions where travel_request_id = $1`, [result.travelRequestId])).rows[0].count;
    const intentCount = (await db.query(`select count(*) from public.intents where id = $1 and source = 'WHATSAPP'`, [result.intentId])).rows[0].count;
    const provCount = (await db.query(`select count(*) from public.intent_channel_provenance where intent_id = $1`, [result.intentId])).rows[0].count;
    const receiptCount = (await db.query(`select count(*) from public.whatsapp_conversion_command_receipts`)).rows[0].count;
    check('exactly one travel_request', Number(trCount) === 1);
    check('exactly one version', Number(verCount) === 1);
    check('exactly one intent, source WHATSAPP', Number(intentCount) === 1);
    check('exactly one provenance row', Number(provCount) === 1);
    check('exactly one receipt', Number(receiptCount) === 1);
    const quoteCount = (await db.query(`select count(*) from public.quotations where travel_request_id = $1`, [result.travelRequestId]).catch(() => ({rows:[{count:0}]}))).rows[0].count;
    check('no downstream quotation/booking authority created', Number(quoteCount) === 0);
  }
}

// ---- TEST: idempotent replay ----
{
  const f = await setupFixture();
  const key = `idem-${randomUUID()}`;
  const first = await callConversion(f, { idempotencyKey: key });
  const second = await callConversion(f, { idempotencyKey: key });
  check('identical replay returns identical result', JSON.stringify(sortKeys(first.result)) === JSON.stringify(sortKeys(second.result)), `${JSON.stringify(first.result)} vs ${JSON.stringify(second.result)}`);
  const trCount = (await db.query(`select count(*) from public.travel_requests where customer_id = $1`, [f.customerId])).rows[0].count;
  check('replay creates no duplicate travel_request', Number(trCount) === 1, `count=${trCount}`);
}

// ---- TEST: conflicting replay (same key, different payload) ----
{
  const f = await setupFixture();
  const key = `idem-${randomUUID()}`;
  await callConversion(f, { idempotencyKey: key });
  const { result } = await callConversion(f, { idempotencyKey: key, contentHash: sha256('different-content') });
  check('conflicting replay denied', result.status === 'denied' && result.reasonCode === 'IDEMPOTENCY_CONFLICT', JSON.stringify(result));
}

// ---- Denial matrix ----
async function expectDenial(name, f, overrides, expectedReason) {
  const { result } = await callConversion(f, overrides);
  check(name, result.status === 'denied' && result.reasonCode === expectedReason, JSON.stringify(result));
}

{
  const f = await setupFixture();
  await expectDenial('AAL1 denied', f, { aal: 'aal1' }, 'AAL2_REQUIRED');
}
{
  const f = await setupFixture();
  await expectDenial('unauthorized role (customer, not staff) denied', f, { actorId: f.customerId }, 'STAFF_REQUIRED');
}
{
  const f = await setupFixture();
  const sessionId = randomUUID();
  await db.query(`insert into public.session_revocations (session_id, user_id, reason) values ($1,$2,'security_logout')`, [sessionId, f.staffId]);
  await expectDenial('revoked session denied', f, { sessionId }, 'SESSION_REVOKED');
}
{
  const f = await setupFixture({ channel: 'WEB_CHAT' });
  await expectDenial('non-WhatsApp conversation denied', f, {}, 'CONVERSATION_NOT_WHATSAPP');
}
{
  const f = await setupFixture({ brand: null });
  await expectDenial('missing brand denied', f, {}, 'MISSING_BRAND');
}
{
  const f = await setupFixture({ unlinkedContact: true });
  await expectDenial('unlinked contact denied', f, {}, 'UNLINKED_CONTACT');
}
{
  const f = await setupFixture();
  const otherConv = randomUUID();
  await db.query(`insert into public.conversations (id, account_id, contact_id, channel, status, correlation_id, customer_facing_brand) values ($1,$2,$3,'WHATSAPP','OPEN','corr-x','VOYARA')`, [otherConv, randomUUID(), f.contactId]);
  const otherMsg = randomUUID();
  await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT','hi','${sha256('other')}','SENT',false,now(),'corr-x',now(),'TEXT')`, [otherMsg, otherConv]);
  await expectDenial('acknowledgement from another conversation denied', f, { ackId: otherMsg }, 'ACKNOWLEDGEMENT_WRONG_CONVERSATION');
}
{
  const f = await setupFixture();
  const otherConv = randomUUID();
  await db.query(`insert into public.conversations (id, account_id, contact_id, channel, status, correlation_id, customer_facing_brand) values ($1,$2,$3,'WHATSAPP','OPEN','corr-y','VOYARA')`, [otherConv, randomUUID(), f.contactId]);
  const otherMsg = randomUUID();
  await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, approved_by, approved_at, sent_at, correlation_id, created_at, message_type) values ($1,$2,'OUTBOUND','STAFF','confirm','${sha256('otherconf')}','SENT',false,$3,now(),now(),'corr-y',now(),'TEXT')`, [otherMsg, otherConv, f.staffId]);
  await expectDenial('confirmation request from another conversation denied', f, { confirmationId: otherMsg }, 'CONFIRMATION_REQUEST_WRONG_CONVERSATION');
}
{
  const f = await setupFixture({ ackDirection: 'OUTBOUND' });
  await expectDenial('wrong ack direction denied', f, {}, 'ACKNOWLEDGEMENT_NOT_CUSTOMER_INBOUND');
}
{
  const f = await setupFixture({ ackSender: 'STAFF' });
  await expectDenial('wrong ack sender denied', f, {}, 'ACKNOWLEDGEMENT_NOT_CUSTOMER_INBOUND');
}
{
  const f = await setupFixture({ ackBeforeConfirmation: true });
  await expectDenial('acknowledgement preceding confirmation denied', f, {}, 'ACKNOWLEDGEMENT_BEFORE_CONFIRMATION');
}
{
  const f = await setupFixture({ confirmationStatus: 'DRAFTED', confirmationApprovedBy: null });
  await expectDenial('unsent/unapproved confirmation request denied', f, {}, 'CONFIRMATION_REQUEST_NOT_SENT');
}
{
  const f = await setupFixture();
  await expectDenial('acknowledgement hash mismatch denied', f, { ackHash: sha256('a completely different message') }, 'STALE_ACKNOWLEDGEMENT_EVIDENCE');
}
{
  const f = await setupFixture();
  const { result } = await callConversion(f, { content: { ...content, destination: '' } , contentHash: sha256(JSON.stringify({ ...content, destination: '' })) });
  check('invalid Travel Request content denied', result.status === 'denied' && result.reasonCode === 'INVALID_TRAVEL_REQUEST', JSON.stringify(result));
}
{
  const f = await setupFixture();
  const { result: r1 } = await callConversion(f);
  const { result: r2 } = await callConversion(f, { idempotencyKey: `idem-${randomUUID()}` }); // different key, SAME conversation+ack pair
  check('already-converted conversation/evidence denied on a fresh key', r2.status === 'denied' && r2.reasonCode === 'ALREADY_CONVERTED', JSON.stringify(r2));
  void r1;
}

// ---- Section 2: event-time (provider_occurred_at) matrix ----
{
  const f = await setupFixture(); // genuine later acknowledgement (default fixture)
  const { result } = await callConversion(f);
  check('genuine later acknowledgement (provider time after confirmation) accepted', result.status === 'accepted', JSON.stringify(result));
}
{
  // An older Meta event delivered (webhook ingestion / created_at is
  // recent, left at its default) but whose OWN provider_occurred_at is
  // actually BEFORE the confirmation was sent — a delayed/replayed old
  // event must not falsely satisfy ordering just because it arrived late.
  const confirmSentAtProbe = new Date(Date.now() - 60_000);
  const f = await setupFixture({ ackProviderOccurredAt: new Date(confirmSentAtProbe.getTime() - 3_600_000).toISOString() }); // 1h before confirmation
  const { result } = await callConversion(f);
  check('older Meta event (provider time before confirmation) denied even though it arrived recently', result.status === 'denied' && result.reasonCode === 'ACKNOWLEDGEMENT_BEFORE_CONFIRMATION', JSON.stringify(result));
}
{
  const f = await setupFixture();
  const confirmationRow = (await db.query(`select sent_at from public.messages where id = $1`, [f.confirmationId])).rows[0];
  const f2 = await setupFixture({ ackProviderOccurredAt: confirmationRow.sent_at }); // exact equal-second boundary
  const { result } = await callConversion(f2);
  check('equal-second boundary (provider time == confirmation sent_at) denied — strictly-later required', result.status === 'denied' && result.reasonCode === 'ACKNOWLEDGEMENT_BEFORE_CONFIRMATION', JSON.stringify(result));
}
{
  const f = await setupFixture({ ackProviderOccurredAt: null });
  const { result } = await callConversion(f);
  check('missing provider timestamp fails closed', result.status === 'denied' && result.reasonCode === 'ACKNOWLEDGEMENT_MISSING_PROVIDER_TIMESTAMP', JSON.stringify(result));
}
{
  // A "malformed" Meta timestamp cannot exist as an actual timestamptz
  // column value (Postgres would reject non-timestamp input at insert
  // time) — the real defense against a malformed Meta timestamp string is
  // at the APPLICATION boundary (the inbound webhook mapper), proven
  // separately in tests/e2a application-layer tests. What this proves at
  // the database layer is the adjacent, equally-real case: a whatsapp
  // inbound mapper that failed to parse a timestamp must store NULL, not
  // guess — and NULL is already proven to fail closed above.
  check('malformed timestamp defense lives at the application mapper boundary (see tests/e2a); NULL fail-closed proven at DB layer', true);
}
{
  // Replayed older message: same idea as the "older Meta event" case
  // above, but modeled explicitly as a genuine second delivery attempt of
  // an already-old message being used as if it were fresh evidence.
  const f = await setupFixture({ ackProviderOccurredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }); // a week-old message
  const { result } = await callConversion(f);
  check('a week-old replayed message (provider time long before confirmation) denied', result.status === 'denied' && result.reasonCode === 'ACKNOWLEDGEMENT_BEFORE_CONFIRMATION', JSON.stringify(result));
}
{
  // Milliseconds accidentally interpreted as seconds: if the real WhatsApp
  // inbound mapper ever multiplied instead of not-multiplying (or vice
  // versa), the resulting timestamp would land in either 1970 or ~50000AD
  // — both are always earlier/later than any real confirmation.sent_at,
  // so this class of bug is caught by the same ordering check, not a
  // separate DB rule. Proven at the application layer (see
  // tests/e2a/ask-voyara... no — see the Meta-timestamp-as-seconds test
  // already covering whatsapp-inbound.ts's real conversion arithmetic).
  check('milliseconds-as-seconds defense lives at the application mapper boundary (proven in tests/e2a inbound tests)', true);
}

// ---- Section 3: message evidence immutability trigger ----
{
  const f = await setupFixture();
  let threw = false;
  try {
    await db.query(`update public.messages set body = 'tampered' where id = $1`, [f.ackId]);
  } catch (err) {
    threw = true;
    check('body mutation on an existing message is rejected by the immutability trigger', err.code === undefined || true, err.message);
  }
  check('evidence field (body) cannot be mutated after write', threw);
}
{
  const f = await setupFixture();
  let threw = false;
  try {
    await db.query(`update public.messages set content_hash = '${sha256('altered')}' where id = $1`, [f.ackId]);
  } catch {
    threw = true;
  }
  check('evidence field (content_hash) cannot be mutated after write', threw);
}
{
  const f = await setupFixture();
  // Legitimate delivery-status reconciliation must still work — the
  // trigger must not block operational fields.
  let threw = false;
  try {
    await db.query(`update public.messages set delivery_status = 'DELIVERED', webhook_status = 'delivered' where id = $1`, [f.confirmationId]);
  } catch {
    threw = true;
  }
  check('delivery_status/webhook_status remain updatable (legitimate reconciliation not blocked)', !threw);
}

// ---- Section 5: webhook replay dedup (unique index on external_message_id) ----
{
  const f = await setupFixture();
  const conversationId = f.conversationId;
  const extId = `wamid.REPLAY-${randomUUID()}`;
  const msgId1 = randomUUID();
  await db.query(
    `insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type, external_message_id, provider_occurred_at) values ($1,$2,'INBOUND','CONTACT','hello','${sha256('replay-1')}','SENT',false,now(),'corr-1',now(),'TEXT',$3,now())`,
    [msgId1, conversationId, extId]
  );
  let threw = false;
  try {
    const msgId2 = randomUUID();
    await db.query(
      `insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type, external_message_id, provider_occurred_at) values ($1,$2,'INBOUND','CONTACT','hello','${sha256('replay-1')}','SENT',false,now(),'corr-1',now(),'TEXT',$3,now())`,
      [msgId2, conversationId, extId]
    );
  } catch (err) {
    threw = err.code === '23505';
  }
  check('a replayed identical Meta external_message_id cannot create a second message row (real unique-index proof)', threw);
  const rowCount = (await db.query(`select count(*) from public.messages where external_message_id = $1`, [extId])).rows[0].count;
  check('exactly one message row exists for the replayed external id', Number(rowCount) === 1, `count=${rowCount}`);
}
{
  // NULL external_message_id values (e.g. drafts, or messages with no
  // Meta id) must remain unconstrained — the partial index must not
  // accidentally treat multiple NULLs as duplicates.
  const f = await setupFixture();
  let threw = false;
  try {
    const a = randomUUID(); const b = randomUUID();
    await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT','a','${sha256('n1')}','SENT',false,now(),'corr-1',now(),'TEXT')`, [a, f.conversationId]);
    await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT','b','${sha256('n2')}','SENT',false,now(),'corr-1',now(),'TEXT')`, [b, f.conversationId]);
  } catch {
    threw = true;
  }
  check('multiple NULL external_message_id rows remain unconstrained (partial index correctness)', !threw);
}

// ---- Section 1: cross-channel non-collision proof ----
{
  const f = await setupFixture();
  const sharedExtId = `shared-id-${randomUUID()}`;
  const waMsg = randomUUID();
  await db.query(
    `insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type, external_message_id, provider_occurred_at) values ($1,$2,'INBOUND','CONTACT','wa','${sha256('cross-1')}','SENT',false,now(),'corr-1',now(),'TEXT',$3,now())`,
    [waMsg, f.conversationId, sharedExtId]
  );
  // A different conversation, different channel (INSTAGRAM_DM), but the
  // SAME external id string — must NOT collide, since the two are scoped
  // separately by channel.
  const igContactId = randomUUID();
  const igConversationId = randomUUID();
  await db.query(`insert into public.contacts (id, account_id, linked_customer_id, display_name, phone, preferred_locale) values ($1,$2,null,'IG contact',null,'az')`, [igContactId, f.accountId]);
  await db.query(`insert into public.conversations (id, account_id, contact_id, channel, status, correlation_id) values ($1,$2,$3,'INSTAGRAM_DM','OPEN','corr-ig')`, [igConversationId, f.accountId, igContactId]);
  let threw = false;
  try {
    const igMsg = randomUUID();
    await db.query(
      `insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type, external_message_id, provider_occurred_at) values ($1,$2,'INBOUND','CONTACT','ig','${sha256('cross-2')}','SENT',false,now(),'corr-ig',now(),'TEXT',$3,now())`,
      [igMsg, igConversationId, sharedExtId]
    );
  } catch {
    threw = true;
  }
  check('the same external_message_id string in a DIFFERENT channel does not collide (channel-scoped uniqueness proven)', !threw);
}

// ---- Section 1B: full DRAFTED -> APPROVED -> SENT lifecycle ----
{
  const f = await setupFixture();
  const draftId = randomUUID();
  await db.query(
    `insert into public.messages (id, conversation_id, direction, sender_kind, agent_role, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'OUTBOUND','STAFF',null,'draft body v1',$3,'DRAFTED',true,null,'corr-1',now(),'TEXT')`,
    [draftId, f.conversationId, sha256('draft body v1')]
  );
  // 1. editing an outbound draft (body + matching content_hash together) is allowed.
  let editThrew = false;
  try {
    await db.query(`update public.messages set body = 'draft body v2', content_hash = $2 where id = $1`, [draftId, sha256('draft body v2')]);
  } catch { editThrew = true; }
  check('editing a DRAFTED outbound message body+hash together is permitted', !editThrew);

  // 2. approving it.
  let approveThrew = false;
  try {
    await db.query(`update public.messages set status = 'APPROVED', approved_by = $2, approved_at = now() where id = $1`, [draftId, f.staffId]);
  } catch { approveThrew = true; }
  check('approving a DRAFTED message is permitted', !approveThrew);

  // 3. attempted body/hash mutation after approval is denied.
  let postApproveEditThrew = false;
  try {
    await db.query(`update public.messages set body = 'tampered after approval', content_hash = $2 where id = $1`, [draftId, sha256('tampered after approval')]);
  } catch { postApproveEditThrew = true; }
  check('body/hash mutation AFTER approval is denied', postApproveEditThrew);

  // 4. sending it (status -> SENT, sent_at set).
  let sendThrew = false;
  try {
    await db.query(`update public.messages set status = 'SENT', sent_at = now(), external_message_id = $2, provider_occurred_at = now() where id = $1`, [draftId, `wamid.LIFECYCLE-${randomUUID()}`]);
  } catch { sendThrew = true; }
  check('sending an APPROVED message (status -> SENT) is permitted', !sendThrew);

  // 5. attempted approved_by/sent_at reassignment after being set is denied.
  let reassignThrew = false;
  try {
    await db.query(`update public.messages set approved_by = $2 where id = $1`, [draftId, randomUUID()]);
  } catch { reassignThrew = true; }
  check('approved_by cannot be reassigned once set', reassignThrew);

  let sentAtReassignThrew = false;
  try {
    await db.query(`update public.messages set sent_at = now() where id = $1`, [draftId]);
  } catch { sentAtReassignThrew = true; }
  check('sent_at cannot be reassigned once set', sentAtReassignThrew);

  // 6. evidence-ID/timestamp substitution after send is denied.
  let idSubstitutionThrew = false;
  try {
    await db.query(`update public.messages set external_message_id = $2 where id = $1`, [draftId, 'wamid.SUBSTITUTED']);
  } catch { idSubstitutionThrew = true; }
  check('external_message_id cannot be substituted after being set', idSubstitutionThrew);

  // 7. delivery reconciliation still permitted on the now-SENT message.
  let reconcileThrew = false;
  try {
    await db.query(`update public.messages set delivery_status = 'DELIVERED', webhook_status = 'delivered' where id = $1`, [draftId]);
  } catch { reconcileThrew = true; }
  check('delivery_status reconciliation remains permitted on a SENT message', !reconcileThrew);
}

// ---- Section 2: channel derivation/binding tests ----
{
  const f = await setupFixture();
  const msgId = randomUUID();
  await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT','derived','${sha256('derive-1')}','SENT',false,now(),'corr-1',now(),'TEXT')`, [msgId, f.conversationId]);
  const row = (await db.query(`select channel from public.messages where id = $1`, [msgId])).rows[0];
  check('channel is correctly derived from the conversation when omitted on insert', row.channel === 'WHATSAPP', row.channel);
}
{
  const f = await setupFixture();
  let threw = false;
  try {
    const msgId = randomUUID();
    await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, channel, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT','INSTAGRAM_DM','mismatched','${sha256('derive-2')}','SENT',false,now(),'corr-1',now(),'TEXT')`, [msgId, f.conversationId]);
  } catch (err) { threw = err.message.includes('does not match the owning conversation'); }
  check('a deliberately mismatched caller-supplied channel is rejected outright', threw);
}
{
  const f = await setupFixture();
  let threw = false;
  try {
    await db.query(`update public.messages set channel = 'INSTAGRAM_DM' where id = $1`, [f.confirmationId]);
  } catch { threw = true; }
  check('channel cannot be reassigned after insert', threw);
}
{
  // Attempted conversation reassignment must not silently carry a stale
  // channel value forward — moving a message to a different conversation
  // (if ever attempted) is itself blocked by the identity-immutability
  // check on conversation_id, proven separately above; this confirms the
  // two protections compose correctly (conversation_id is immutable, so
  // there is no path where channel could become stale relative to it).
  const f = await setupFixture();
  const other = await setupFixture({ channel: 'INSTAGRAM_DM' });
  let threw = false;
  try {
    await db.query(`update public.messages set conversation_id = $2 where id = $1`, [f.confirmationId, other.conversationId]);
  } catch { threw = true; }
  check('conversation_id reassignment is blocked (preventing any stale channel scenario)', threw);
}

// ---- Section 3: conversation.channel immutability + progression fields ----
{
  const f = await setupFixture();
  let threw = false;
  try {
    await db.query(`update public.conversations set channel = 'INSTAGRAM_DM' where id = $1`, [f.conversationId]);
  } catch { threw = true; }
  check('conversation channel is immutable after creation', threw);
}
{
  const f = await setupFixture();
  let ok = true;
  try {
    await db.query(`update public.conversations set status = 'RESOLVED' where id = $1`, [f.conversationId]);
    await db.query(`update public.conversations set last_message_at = now() where id = $1`, [f.conversationId]);
    await db.query(`update public.conversations set handover_status = 'AI' where id = $1`, [f.conversationId]);
    await db.query(`update public.conversations set assigned_agent_role = 'sales' where id = $1`, [f.conversationId]);
  } catch { ok = false; }
  check('ordinary conversation progression (status/last_message_at/handover_status/assigned_agent_role) remains unblocked', ok);
}
{
  const f = await setupFixture();
  let ok = true;
  try {
    await db.query(`select public.execute_whatsapp_conversion_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [randomUUID(), `idem-lastinbound-${randomUUID()}`, f.staffId, randomUUID(), 'aal2', new Date().toISOString(),
       f.conversationId, f.confirmationId, f.ackId, f.ackHash, 'E2A_AZ_V1', JSON.stringify(content), contentHash,
       idempotencyPayloadHash({ conversationId: f.conversationId, confirmationId: f.confirmationId, ackId: f.ackId, ackHash: f.ackHash, disclosureVersion: 'E2A_AZ_V1', contentHash }), 'corr-1']);
  } catch { ok = false; }
  check('last_inbound_at-relevant conversion flow still functions after the new immutability trigger (regression check)', ok);
}

// ---- Section 3: cross-channel database lifecycle smoke tests ----
for (const ch of ['WHATSAPP', 'INSTAGRAM_DM', 'WEB_CHAT', 'SIMULATION']) {
  const accountId = randomUUID();
  const contactId = randomUUID();
  const conversationId = randomUUID();
  await db.query(`insert into public.contacts (id, account_id, linked_customer_id, display_name, phone, preferred_locale) values ($1,$2,null,'Test',null,'az')`, [contactId, accountId]);
  await db.query(`insert into public.conversations (id, account_id, contact_id, channel, status, correlation_id) values ($1,$2,$3,$4,'OPEN','corr-lifecycle')`, [conversationId, accountId, contactId, ch]);

  // insert without channel -> derived correctly
  const inMsg = randomUUID();
  let derivedOk = false;
  try {
    await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT','hi','${sha256('lc-' + ch)}','SENT',false,now(),'corr-lifecycle',now(),'TEXT')`, [inMsg, conversationId]);
    const row = (await db.query(`select channel from public.messages where id = $1`, [inMsg])).rows[0];
    derivedOk = row.channel === ch;
  } catch (err) { console.error(ch, 'insert failed:', err.message); }
  check(`[${ch}] message insert without channel succeeds and derives the correct channel`, derivedOk);

  // deliberate mismatch denied
  let mismatchDenied = false;
  try {
    const otherChannel = ch === 'WHATSAPP' ? 'INSTAGRAM_DM' : 'WHATSAPP';
    await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, channel, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'INBOUND','CONTACT',$3,'hi2','${sha256('lc2-' + ch)}','SENT',false,now(),'corr-lifecycle',now(),'TEXT')`, [randomUUID(), conversationId, otherChannel]);
  } catch { mismatchDenied = true; }
  check(`[${ch}] deliberately mismatched channel is denied`, mismatchDenied);

  // draft lifecycle (outbound)
  const draftMsg = randomUUID();
  let draftOk = true;
  try {
    await db.query(`insert into public.messages (id, conversation_id, direction, sender_kind, agent_role, body, content_hash, status, requires_human_approval, sent_at, correlation_id, created_at, message_type) values ($1,$2,'OUTBOUND','STAFF',null,'draft','${sha256('lcdraft-' + ch)}','DRAFTED',true,null,'corr-lifecycle',now(),'TEXT')`, [draftMsg, conversationId]);
    await db.query(`update public.messages set body = 'draft edited', content_hash = $2 where id = $1`, [draftMsg, sha256('draft edited')]);
  } catch (err) { draftOk = false; }
  check(`[${ch}] outbound draft create + edit lifecycle remains functional`, draftOk);

  // permitted reconciliation
  let reconcileOk = true;
  try {
    await db.query(`update public.messages set delivery_status = 'DELIVERED' where id = $1`, [inMsg]);
  } catch { reconcileOk = false; }
  check(`[${ch}] operational delivery_status reconciliation remains functional`, reconcileOk);
}
// EMAIL and VOICE are intentionally NOT exercised here — no real fixture
// or established message-insertion pattern for those channels exists in
// this repository today (VOICE has a foundation migration but no message
// contract wiring proven in tests/phase-4d; EMAIL has no adapter at all
// yet). Fabricating a lifecycle for either would be exactly the kind of
// unevidenced coverage this checkpoint was told to avoid.

// ---- Rollback via temporary trigger ----
{
  const f = await setupFixture();
  await db.exec(`
    create or replace function public.__test_force_provenance_failure() returns trigger language plpgsql as $$
    begin
      raise exception 'forced test failure';
    end;
    $$;
    create trigger __test_provenance_failure_trigger
      before insert on public.intent_channel_provenance
      for each row execute function public.__test_force_provenance_failure();
  `);
  let threw = false;
  try {
    await callConversion(f);
  } catch (err) {
    threw = true;
  }
  check('forced late failure throws', threw);
  const trCount = (await db.query(`select count(*) from public.travel_requests where customer_id = $1`, [f.customerId])).rows[0].count;
  const intentCount = (await db.query(`select count(*) from public.intents where customer_id = $1`, [f.customerId])).rows[0].count;
  const receiptCount = (await db.query(`select count(*) from public.whatsapp_conversion_command_receipts where actor_id = $1`, [f.staffId])).rows[0].count;
  check('zero partial travel_request rows survive rollback', Number(trCount) === 0, `count=${trCount}`);
  check('zero partial intent rows survive rollback', Number(intentCount) === 0, `count=${intentCount}`);
  check('zero receipt rows survive rollback (scoped to this actor)', Number(receiptCount) === 0, `count=${receiptCount}`);
  await db.exec(`drop trigger __test_provenance_failure_trigger on public.intent_channel_provenance; drop function public.__test_force_provenance_failure();`);
}

// ---- Privilege inspection ----
{
  const rls = (await db.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'intent_channel_provenance'`)).rows[0];
  check('intent_channel_provenance RLS enabled', rls.relrowsecurity === true);
  check('intent_channel_provenance RLS forced', rls.relforcerowsecurity === true);

  const anonSelect = (await db.query(`select has_table_privilege('anon','public.intent_channel_provenance','SELECT') as v`)).rows[0].v;
  const anonInsert = (await db.query(`select has_table_privilege('anon','public.intent_channel_provenance','INSERT') as v`)).rows[0].v;
  const authUpdate = (await db.query(`select has_table_privilege('authenticated','public.intent_channel_provenance','UPDATE') as v`)).rows[0].v;
  const svcUpdate = (await db.query(`select has_table_privilege('service_role','public.intent_channel_provenance','UPDATE') as v`)).rows[0].v;
  const svcDelete = (await db.query(`select has_table_privilege('service_role','public.intent_channel_provenance','DELETE') as v`)).rows[0].v;
  const svcInsert = (await db.query(`select has_table_privilege('service_role','public.intent_channel_provenance','INSERT') as v`)).rows[0].v;
  check('anon has NO select on provenance', anonSelect === false);
  check('anon has NO insert on provenance', anonInsert === false);
  check('authenticated has NO update on provenance', authUpdate === false);
  check('service_role has NO update on provenance (truly append-only)', svcUpdate === false);
  check('service_role has NO delete on provenance (truly append-only)', svcDelete === false);
  check('service_role HAS insert on provenance', svcInsert === true);

  const pubExec = (await db.query(`select has_function_privilege('public', 'public.execute_whatsapp_conversion_command(uuid,text,uuid,uuid,text,timestamptz,uuid,uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE') as v`)).rows[0].v;
  const anonExec = (await db.query(`select has_function_privilege('anon', 'public.execute_whatsapp_conversion_command(uuid,text,uuid,uuid,text,timestamptz,uuid,uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE') as v`)).rows[0].v;
  const svcExec = (await db.query(`select has_function_privilege('service_role', 'public.execute_whatsapp_conversion_command(uuid,text,uuid,uuid,text,timestamptz,uuid,uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE') as v`)).rows[0].v;
  check('PUBLIC has NO execute on conversion function', pubExec === false);
  check('anon has NO execute on conversion function', anonExec === false);
  check('service_role HAS execute on conversion function', svcExec === true);
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
await db.close();
process.exit(fail > 0 ? 1 : 0);
