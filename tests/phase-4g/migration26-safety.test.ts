import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const FOUNDER = '55555555-5555-4555-8555-555555555555';
const STAFF1 = '33333333-3333-4333-8333-333333333333';

async function pool() {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: PG_URL, max: 6 });
}
async function svcQuery(p: Awaited<ReturnType<typeof pool>>, sql: string, params?: unknown[]) {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    const result = await c.query(sql, params);
    await c.query('commit');
    return result;
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
async function asRole(
  p: Awaited<ReturnType<typeof pool>>,
  role: 'authenticated' | 'service_role',
  claims: Record<string, unknown> | null,
  fn: (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }) => Promise<void>
): Promise<void> {
  const c = await p.connect();
  try {
    await c.query('begin');
    if (claims) await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`set local role ${role}`);
    await fn(c);
    await c.query('rollback');
  } finally {
    c.release();
  }
}
function claimsFor(sub: string, aal: 'aal1' | 'aal2') {
  return { sub, aal, role: 'authenticated', session_id: randomUUID(), iat: Math.floor(Date.now() / 1000) };
}

async function seedDefinition(p: Awaited<ReturnType<typeof pool>>) {
  const id = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-mig26-seed')`, [id, `mig26.test.${randomUUID().slice(0, 8)}`]);
  return id;
}

async function seedSupplier(p: Awaited<ReturnType<typeof pool>>) {
  const supplierId = randomUUID();
  await svcQuery(
    p,
    `insert into suppliers (id, legal_name, supplier_type, countries, destinations, currencies, languages, operational_contacts, finance_contacts, emergency_contacts, api_available, integration_status, contract_status, commercial_priority, risk_status, correlation_id)
     values ($1,'Mig26 Supplier','DIRECT_HOTEL','{AZ}','{Baku}','{AZN}','{az}','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,false,'PORTAL_ONLY','ACTIVE',2,'LOW','corr-4g-mig26-seed')`,
    [supplierId]
  );
  return supplierId;
}

async function seedContact(p: Awaited<ReturnType<typeof pool>>) {
  const contactId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Mig26 Contact')`, [contactId, randomUUID()]);
  return contactId;
}

async function seedActiveContract(p: Awaited<ReturnType<typeof pool>>, supplierId: string) {
  const { draftContract, approveAndActivateContract } = await import('@/server/agents/supplier-ops/contract-service');
  const contracts = new Map<string, unknown>();
  const contractStore = {
    saveContract: async (c: { contractId: string }) => { contracts.set(c.contractId, c); },
    loadContract: async (id: string) => contracts.get(id) ?? null,
    saveContractVersion: async () => { /* not needed for this test */ },
    findContractByReference: async () => null
  };
  const ctx = { store: contractStore as never, correlationId: 'corr-4g-mig26-seed', now: () => new Date() };
  const { contractId } = await draftContract(ctx, {
    agreementType: 'NET_RATE', rtravelLegalEntity: 'RTravel MMC', supplierId, supplierLegalEntity: 'Mig26 Supplier',
    contractReference: `MIG26-${randomUUID().slice(0, 8)}`, effectiveDate: '2026-01-01', expiryDate: null, renewalConditions: null,
    territory: null, productsCovered: ['HOTEL'], pricingStructure: 'net rate', markupRules: {}, minimumAdvertisedPriceRestriction: null,
    currency: 'AZN', paymentTerms: null, depositOrCreditLineRequirement: null, cancellationRules: null,
    refundResponsibility: 'supplier', chargebackResponsibility: 'supplier', bookingVoucherRequirements: null,
    resalePermissions: {}, voyaraBrandingAllowed: true, rtravelIdentityRequired: false, confidentialityRestrictions: null
  });
  await approveAndActivateContract(ctx, contractId, FOUNDER);
  // The in-memory contractStore above satisfies prepareTask's APPLICATION-
  // level authority check only — portal_tasks.contract_id also has a real
  // DATABASE-level foreign key to the real `contracts` table, which the
  // in-memory store never touches. Seed a real matching row too.
  const activated = (await contractStore.loadContract(contractId)) as {
    agreementType: string; rtravelLegalEntity: string; supplierLegalEntity: string; contractReference: string;
    effectiveDate: string; productsCovered: string[]; pricingStructure: string; refundResponsibility: string;
    chargebackResponsibility: string; status: string; approvedBy: string; approvedAt: string; contentHash: string; version: number;
  };
  await svcQuery(
    p,
    `insert into contracts (id, agreement_type, rtravel_legal_entity, supplier_id, supplier_legal_entity, contract_reference, effective_date, products_covered, pricing_structure, markup_rules, currency, refund_responsibility, chargeback_responsibility, resale_permissions, voyara_branding_allowed, rtravel_identity_required, status, approved_by, approved_at, content_hash, version, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,'AZN',$10,$11,'{}'::jsonb,true,false,$12,$13,$14,$15,$16,'corr-4g-mig26-seed')`,
    [contractId, activated.agreementType, activated.rtravelLegalEntity, supplierId, activated.supplierLegalEntity, activated.contractReference,
      activated.effectiveDate, activated.productsCovered, activated.pricingStructure, activated.refundResponsibility, activated.chargebackResponsibility,
      activated.status, activated.approvedBy, activated.approvedAt, activated.contentHash, activated.version]
  );
  return { contractId, contractStore };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'corr-4g-mig26%' or idempotency_key like 'idem-4g-mig26%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from portal_task_idempotency_keys where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from portal_task_events where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from portal_tasks where correlation_id like 'corr-4g-mig26%'`);
  await svcQuery(p, `delete from contracts where correlation_id = 'corr-4g-mig26-seed'`);
  await svcQuery(p, `delete from suppliers where correlation_id = 'corr-4g-mig26-seed'`);
  await svcQuery(p, `delete from contacts where display_name = 'Mig26 Contact'`);
}

gated('reserve-first workflow idempotency succeeds end-to-end through createWorkflowRun after Migration 26', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-mig26-seed', now: () => new Date() };
    const definitionId = await seedDefinition(p);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);

    const { workflowRunId, created } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-mig26-${randomUUID()}`);
    assert.equal(created, true);
    const run = await store.loadWorkflowRun(workflowRunId);
    assert.ok(run);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('five-way concurrent createWorkflowRun calls with the same idempotency key produce exactly one real workflow run', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-mig26-seed', now: () => new Date() };
    const definitionId = await seedDefinition(p);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);

    const idempotencyKey = `idem-4g-mig26-concurrent-${randomUUID()}`;
    const attempt = () => createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, idempotencyKey);
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    const winners = results.filter((r) => r.created);
    const runIds = new Set(results.map((r) => r.workflowRunId));
    assert.equal(winners.length, 1);
    assert.equal(runIds.size, 1);

    const rows = await svcQuery(p, `select count(*)::int as n from workflow_runs where correlation_id = 'corr-4g-mig26-seed' and workflow_version_id = $1`, [workflowVersionId]);
    assert.equal(rows.rows[0].n, 1);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('if a reservation wins but the run is never created, no caller can mistake the reservation for a completed run', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const store = new SupabaseAutomationStore();
    const key = `idem-4g-mig26-orphan-${randomUUID()}`;
    const proposedRunId = randomUUID();

    const reservation = await store.reserveWorkflowIdempotencyKey(key, proposedRunId);
    assert.equal(reservation.winner, true);

    const run = await store.loadWorkflowRun(proposedRunId);
    assert.equal(run, null);

    const second = await store.reserveWorkflowIdempotencyKey(key, randomUUID());
    assert.equal(second.winner, false);
    assert.equal(second.workflowRunId, proposedRunId);
    await svcQuery(p, `delete from workflow_idempotency_keys where idempotency_key = $1`, [key]);
  } finally {
    await p.end();
  }
});

gated('portal-task reserve-first preparation succeeds end-to-end through prepareTask after Migration 26 removed the FK', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const { contractId, contractStore } = await seedActiveContract(p, supplierId);
    const contactId = await seedContact(p);
    const { prepareTask } = await import('@/server/agents/supplier-ops/portal-task-service');
    const { SupabasePortalTaskStore } = await import('@/server/agents/supplier-ops/supabase-portal-task-store');
    const store = new SupabasePortalTaskStore();
    const ctx = { store, supplierStore: contractStore as never, correlationId: 'corr-4g-mig26-seed', now: () => new Date() };

    const { portalTaskId } = await prepareTask(ctx, { supplierId, contractId, contactId, conversationId: null, bookingData: {}, checklist: [] }, `idem-4g-mig26-portal-${randomUUID()}`);
    const task = await store.loadTask(portalTaskId);
    assert.ok(task);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('duplicate portal-task preparation with the same idempotency key remains genuinely idempotent — never creates a second task', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const { contractId, contractStore } = await seedActiveContract(p, supplierId);
    const contactId = await seedContact(p);
    const { prepareTask } = await import('@/server/agents/supplier-ops/portal-task-service');
    const { SupabasePortalTaskStore } = await import('@/server/agents/supplier-ops/supabase-portal-task-store');
    const store = new SupabasePortalTaskStore();
    const ctx = { store, supplierStore: contractStore as never, correlationId: 'corr-4g-mig26-seed', now: () => new Date() };

    const idempotencyKey = `idem-4g-mig26-portal-dup-${randomUUID()}`;
    const first = await prepareTask(ctx, { supplierId, contractId, contactId, conversationId: null, bookingData: {}, checklist: [] }, idempotencyKey);
    const second = await prepareTask(ctx, { supplierId, contractId, contactId, conversationId: null, bookingData: {}, checklist: [] }, idempotencyKey);
    assert.equal(first.portalTaskId, second.portalTaskId);

    const rows = await svcQuery(p, `select count(*)::int as n from portal_tasks where correlation_id = 'corr-4g-mig26-seed' and supplier_id = $1`, [supplierId]);
    assert.equal(rows.rows[0].n, 1);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('pause-control scope uniqueness remains enforced after Migration 26 (unrelated to the FK removal)', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `delete from automation_pause_controls where scope = 'GLOBAL'`);
    await svcQuery(p, `insert into automation_pause_controls (id, scope, correlation_id) values ($1,'GLOBAL','corr-4g-mig26-seed')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, correlation_id) values ($1,'GLOBAL','corr-4g-mig26-seed')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await svcQuery(p, `delete from automation_pause_controls where scope = 'GLOBAL'`);
  } finally {
    await p.end();
  }
});

gated('emergency-stop singleton remains enforced after Migration 26 (unrelated to the FK removal)', async () => {
  const p = await pool();
  try {
    const rows = await svcQuery(p, `select count(*)::int as n from emergency_stop_state`);
    assert.equal(rows.rows[0].n, 1);
    await assert.rejects(
      () => svcQuery(p, `insert into emergency_stop_state (id, active, correlation_id) values (2, false, 'corr-4g-mig26-seed')`),
      (e: unknown) => /emergency_stop_state_singleton/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('RLS and append-only workflow_execution_events guarantees remain intact after Migration 26', async () => {
  const p = await pool();
  try {
    const definitionId = await seedDefinition(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-mig26-seed', now: () => new Date() };
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-mig26-${randomUUID()}`);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from workflow_runs where id = $1`, [workflowRunId]);
      assert.equal(r.rowCount, 1);
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from workflow_runs where id = $1`, [workflowRunId]);
      assert.equal(r.rowCount, 0);
    });

    const eventRow = await svcQuery(p, `select id from workflow_execution_events where workflow_run_id = $1 limit 1`, [workflowRunId]);
    const eventId = eventRow.rows[0].id as string;
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const del = await c.query(`delete from workflow_execution_events where id = $1`, [eventId]);
      assert.equal(del.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});
