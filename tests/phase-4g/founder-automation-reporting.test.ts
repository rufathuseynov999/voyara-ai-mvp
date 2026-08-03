import assert from 'node:assert/strict';
import test from 'node:test';

test('loadAutomationOpsSnapshot returns an honestly unavailable snapshot when no database connection exists, never a fabricated zero-filled one', async () => {
  const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
  const snapshot = await loadAutomationOpsSnapshot();
  assert.equal(snapshot.dataAvailability, 'unavailable');
  assert.equal(snapshot.completedWorkflows, null);
  assert.equal(snapshot.failedWorkflows, null);
  assert.equal(snapshot.workflowTotalsByStatus, null);
  assert.ok(snapshot.unavailableReasons.length > 0);
});

test('AutomationOpsSnapshot never uses 0 as a silent stand-in for "unknown" — an unavailable metric is always null, distinguishable from a real zero count', async () => {
  const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
  const snapshot = await loadAutomationOpsSnapshot();
  const numericFields = [
    snapshot.completedWorkflows, snapshot.failedWorkflows, snapshot.pausedWorkflows, snapshot.deadLetteredWorkflows,
    snapshot.approvalBacklog, snapshot.slaBreaches, snapshot.leadsAwaitingResponse, snapshot.proposalsAwaitingApproval,
    snapshot.supplierTaskBacklog, snapshot.bookingDeadlinesNext7Days, snapshot.ticketingDeadlinesNext7Days,
    snapshot.corporateWorkload, snapshot.humanTakeoverRate, snapshot.unresolvedOperationalRisks
  ];
  for (const field of numericFields) assert.equal(field, null);
});

test('automation-ops-panel.tsx contains no button, form, or onClick handler — a strictly read-only display component', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/components/automation-ops-panel.tsx', import.meta.url), 'utf8');
  assert.ok(!/<button/i.test(raw));
  assert.ok(!/<form/i.test(raw));
  assert.ok(!/onClick|onSubmit|onChange/i.test(raw));
});

test('automation-ops-panel.tsx contains no reference to retry, approve, takeover, or release actions — no mutation vocabulary at all', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/components/automation-ops-panel.tsx', import.meta.url), 'utf8');
  assert.ok(!/function\s+\w*(retry|approve|takeover|release)/i.test(raw));
});

test('automation-ops-queries.ts contains no arithmetic estimation function (no averaging, projecting, or extrapolating from partial data)', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/automation-ops-queries.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/estimate|project|extrapolat|average\(/i.test(codeOnly));
});

test('automation-ops-queries.ts contains no INSERT, UPDATE, or DELETE — every query is a plain SELECT', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/automation-ops-queries.ts', import.meta.url), 'utf8');
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(raw));
});
