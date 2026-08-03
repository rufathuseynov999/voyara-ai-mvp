import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customer = 'd1000000-0000-4000-8000-000000000001';
const founder = 'd1000000-0000-4000-8000-000000000002';
const session = 'd2000000-0000-4000-8000-000000000001';
const requestId = 'd3000000-0000-4000-8000-000000000001';
const quotationA = 'd4000000-0000-4000-8000-000000000001';
const quotationB = 'd4000000-0000-4000-8000-000000000002';
const paymentA = 'd5000000-0000-4000-8000-000000000001';
const paymentB = 'd5000000-0000-4000-8000-000000000002';
const bookingA = 'd6000000-0000-4000-8000-000000000001';
const bookingB = 'd6000000-0000-4000-8000-000000000002';
const supportCase = 'd7000000-0000-4000-8000-000000000001';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const hashD = 'd'.repeat(64);
const hashE = 'e'.repeat(64);

async function setupDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  `);
  for (const migration of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  }
  await database.exec(`
    insert into auth.users (id, email) values
      ('${customer}', 'customer-task010@voyara.example'),
      ('${founder}', 'founder-task010@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by)
    values ('${founder}', 'founder', '${founder}');

    set session_replication_role = replica;

    insert into public.travel_requests (
      id, customer_id, status, current_version, assigned_staff_id,
      claimed_at, submitted_at, created_at, updated_at
    ) values (
      '${requestId}', '${customer}', 'HUMAN_REVIEW', 1, '${founder}',
      now() - interval '3 hours', now() - interval '4 hours',
      now() - interval '5 hours', now() - interval '2 hours'
    );

    insert into public.commercial_quotations (
      id, travel_request_id, customer_id, source_request_version, source_request_hash,
      status, current_version, current_hash, created_by, created_at, updated_at
    ) values (
      '${quotationA}', '${requestId}', '${customer}', 1, '${hashA}',
      'PENDING_APPROVAL', 1, '${hashA}', '${founder}',
      now() - interval '2 hours', now() - interval '90 minutes'
    );

    insert into public.quotation_versions (
      quotation_id, version_number, travel_request_id, source_request_version,
      source_request_hash, customer_id, canonical_payload, payload_hash,
      created_by_kind, created_by, created_at
    ) values
      (
        '${quotationA}', 1, '${requestId}', 1, '${hashA}', '${customer}',
        '{"customer":{"totalMinor":600000},"commercial":{"grossProfitMinor":120000}}'::jsonb,
        '${hashA}', 'human', '${founder}', now() - interval '2 hours'
      ),
      (
        '${quotationB}', 1, '${requestId}', 1, '${hashB}', '${customer}',
        '{"customer":{"totalMinor":250000},"commercial":{"grossProfitMinor":-20000}}'::jsonb,
        '${hashB}', 'human', '${founder}', now() - interval '2 hours'
      );

    insert into public.payment_requests (
      id, quotation_id, quotation_version, quotation_hash, acceptance_id,
      customer_id, locale, currency, amount_minor, status, created_by,
      created_at, updated_at
    ) values (
      '${paymentA}', 'd4000000-0000-4000-8000-000000000003', 1, '${hashC}',
      'd8000000-0000-4000-8000-000000000001', '${customer}', 'az', 'AZN',
      400000, 'REQUESTED', '${founder}', now() - interval '2 hours', now() - interval '1 hour'
    );
    insert into public.payment_requests (
      id, quotation_id, quotation_version, quotation_hash, acceptance_id,
      customer_id, locale, currency, amount_minor, status,
      current_evidence_id, current_evidence_hash, current_review_id,
      current_verification_id, current_verification_hash,
      created_by, created_at, updated_at, evidence_received_at, review_started_at
    ) values (
      '${paymentB}', 'd4000000-0000-4000-8000-000000000004', 1, '${hashD}',
      'd8000000-0000-4000-8000-000000000002', '${customer}', 'az', 'AZN',
      300000, 'EVIDENCE_REJECTED',
      'd8100000-0000-4000-8000-000000000001', '${hashC}',
      'd8100000-0000-4000-8000-000000000002',
      'd8100000-0000-4000-8000-000000000003', '${hashD}',
      '${founder}', now() - interval '3 hours', now() - interval '30 minutes',
      now() - interval '2 hours', now() - interval '90 minutes'
    );

    insert into public.bookings (
      id, payment_request_id, readiness_evaluation_id, readiness_evaluation_hash,
      acceptance_id, quotation_id, quotation_version, quotation_hash,
      customer_id, locale, currency, amount_minor, status,
      canonical_authority_payload, booking_authority_hash,
      current_execution_id, current_execution_hash,
      supplier_confirmation_id, supplier_confirmation_hash,
      created_by, actor_session_id, actor_aal, created_at, updated_at,
      supplier_executed_at, supplier_confirmed_at,
      current_verification_review_id, current_verification_id, current_verification_hash,
      voucher_id, voucher_version, voucher_hash,
      verification_started_at, verified_at, voucher_issued_at
    ) values (
      '${bookingA}', 'd8200000-0000-4000-8000-000000000001',
      'd8200000-0000-4000-8000-000000000002', '${hashA}',
      'd8200000-0000-4000-8000-000000000003', '${quotationA}', 1, '${hashA}',
      '${customer}', 'az', 'AZN', 600000, 'VOUCHER_ISSUED', '{}'::jsonb, '${hashB}',
      'd8200000-0000-4000-8000-000000000004', '${hashC}',
      'd8200000-0000-4000-8000-000000000005', '${hashD}',
      '${founder}', '${session}', 'aal2', now() - interval '1 day', now() - interval '1 hour',
      now() - interval '20 hours', now() - interval '18 hours',
      'd8200000-0000-4000-8000-000000000006',
      'd8200000-0000-4000-8000-000000000007', '${hashE}',
      'd8200000-0000-4000-8000-000000000008', 1, '${hashA}',
      now() - interval '17 hours', now() - interval '16 hours', now() - interval '15 hours'
    );
    insert into public.bookings (
      id, payment_request_id, readiness_evaluation_id, readiness_evaluation_hash,
      acceptance_id, quotation_id, quotation_version, quotation_hash,
      customer_id, locale, currency, amount_minor, status,
      canonical_authority_payload, booking_authority_hash,
      current_execution_id, current_execution_hash,
      supplier_confirmation_id, supplier_confirmation_hash,
      created_by, actor_session_id, actor_aal, created_at, updated_at,
      supplier_executed_at, supplier_confirmed_at,
      current_verification_review_id, current_verification_id, current_verification_hash,
      verification_started_at
    ) values (
      '${bookingB}', 'd8300000-0000-4000-8000-000000000001',
      'd8300000-0000-4000-8000-000000000002', '${hashA}',
      'd8300000-0000-4000-8000-000000000003', '${quotationB}', 1, '${hashB}',
      '${customer}', 'az', 'AZN', 250000, 'VERIFICATION_REJECTED', '{}'::jsonb, '${hashB}',
      'd8300000-0000-4000-8000-000000000004', '${hashC}',
      'd8300000-0000-4000-8000-000000000005', '${hashD}',
      '${founder}', '${session}', 'aal2', now() - interval '1 day', now() - interval '20 minutes',
      now() - interval '20 hours', now() - interval '18 hours',
      'd8300000-0000-4000-8000-000000000006',
      'd8300000-0000-4000-8000-000000000007', '${hashE}',
      now() - interval '17 hours'
    );

    insert into public.fund_allocations (
      id, payment_request_id, verification_id, verification_hash,
      customer_id, quotation_id, quotation_version, quotation_hash,
      currency, amount_minor, canonical_payload, allocation_hash,
      allocated_by, actor_session_id, actor_aal, allocated_at
    ) values (
      'd8400000-0000-4000-8000-000000000001',
      'd8400000-0000-4000-8000-000000000002',
      'd8400000-0000-4000-8000-000000000003', '${hashA}',
      '${customer}', 'd8400000-0000-4000-8000-000000000004', 1, '${hashB}',
      'AZN', 175000, '{}'::jsonb, '${hashC}', '${founder}', '${session}', 'aal2',
      now() - interval '10 minutes'
    );

    insert into public.support_cases (
      id, booking_id, voucher_id, voucher_version, voucher_hash,
      customer_id, locale, category, subject, status, priority,
      escalation_level, owner_id, case_authority_hash,
      current_event_sequence, current_event_hash, opened_at, updated_at
    ) values (
      '${supportCase}', '${bookingA}', 'd8500000-0000-4000-8000-000000000001', 1, '${hashA}',
      '${customer}', 'az', 'TRAVEL_DISRUPTION', 'Synthetic critical case',
      'OPEN', 'P1_CRITICAL', 'FOUNDER', null, '${hashB}', 1, '${hashC}',
      now() - interval '1 hour', now() - interval '5 minutes'
    );

    set session_replication_role = origin;
  `);
  return database;
}

test('Founder read model keeps metrics distinct, derives queues, and remains service-only', async () => {
  const database = await setupDatabase();
  try {
    const viewSecurity = await database.query<{
      relname: string;
      security_invoker: boolean;
      authenticated_select: boolean;
      service_select: boolean;
    }>(`
      select c.relname,
        coalesce('security_invoker=true' = any(c.reloptions), false) as security_invoker,
        has_table_privilege('authenticated', 'public.' || c.relname, 'select') as authenticated_select,
        has_table_privilege('service_role', 'public.' || c.relname, 'select') as service_select
      from pg_class c
      where c.relname like 'founder_%' and c.relkind = 'v'
      order by c.relname
    `);
    assert.equal(viewSecurity.rows.length, 6);
    assert.ok(viewSecurity.rows.every((view) => view.security_invoker));
    assert.ok(viewSecurity.rows.every((view) => !view.authenticated_select));
    assert.ok(viewSecurity.rows.every((view) => view.service_select));

    await database.exec('set role service_role');
    const metrics = await database.query<{
      metric_code: string;
      availability: string;
      amount_minor: number | null;
      basis_code: string;
    }>('select metric_code, availability, amount_minor, basis_code from public.founder_financial_metrics order by display_order');
    assert.equal(metrics.rows.length, 6);
    const byCode = new Map(metrics.rows.map((row) => [row.metric_code, row]));
    assert.deepEqual(byCode.get('CASH'), {
      metric_code: 'CASH', availability: 'UNAVAILABLE', amount_minor: null,
      basis_code: 'NO_CASH_OR_BANK_LEDGER'
    });
    assert.deepEqual(byCode.get('REVENUE'), {
      metric_code: 'REVENUE', availability: 'UNAVAILABLE', amount_minor: null,
      basis_code: 'NO_REVENUE_RECOGNITION_LEDGER'
    });
    assert.equal(byCode.get('GBV')?.amount_minor, 850000);
    assert.equal(byCode.get('PLANNED_GROSS_PROFIT')?.amount_minor, 100000);
    assert.equal(byCode.get('RECEIVABLES')?.amount_minor, 700000);
    assert.equal(byCode.get('EXPOSURE')?.amount_minor, 175000);

    const decisions = await database.query<{ queue_code: string; entity_id: string }>(
      'select queue_code, entity_id from public.founder_decision_queue order by priority_order'
    );
    assert.ok(decisions.rows.some((item) => item.queue_code === 'COMMERCIAL_APPROVAL' && item.entity_id === quotationA));
    assert.ok(decisions.rows.some((item) => item.queue_code === 'SUPPORT_ESCALATION' && item.entity_id === supportCase));

    const exceptions = await database.query<{ exception_code: string }>(
      'select exception_code from public.founder_critical_exceptions order by severity_order'
    );
    assert.deepEqual(new Set(exceptions.rows.map(({ exception_code }) => exception_code)), new Set([
      'PAYMENT_EVIDENCE_REJECTED', 'BOOKING_VERIFICATION_REJECTED', 'SUPPORT_CRITICAL'
    ]));

    const pipeline = await database.query<{ stage_code: string }>(
      'select stage_code from public.founder_pipeline_summary order by stage_order'
    );
    assert.equal(pipeline.rows.length, 10);

    const workloads = await database.query<{ actor_id: string | null; total_items: number }>(
      'select actor_id, total_items from public.founder_team_workload order by actor_id nulls last'
    );
    assert.ok(workloads.rows.some((row) => row.actor_id === founder && row.total_items === 1));
    assert.ok(workloads.rows.some((row) => row.actor_id === null && row.total_items === 2));

    const sources = await database.query<{ source_code: string; source_status: string }>(
      'select source_code, source_status from public.founder_source_freshness order by source_order'
    );
    assert.equal(sources.rows.length, 10);
    assert.equal(sources.rows.find(({ source_code }) => source_code === 'MEMBERSHIP')?.source_status, 'NOT_IMPLEMENTED');
    assert.equal(sources.rows.find(({ source_code }) => source_code === 'AI_ACTIVITY_AND_COST')?.source_status, 'NOT_IMPLEMENTED');
    assert.equal(sources.rows.find(({ source_code }) => source_code === 'SYSTEM_MONITORING')?.source_status, 'NOT_IMPLEMENTED');
  } finally {
    await database.close();
  }
});
