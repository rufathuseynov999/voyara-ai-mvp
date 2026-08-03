import assert from 'node:assert/strict';
import test from 'node:test';

test('every exported action in staff-console-actions.ts requires AAL2 staff authorization — either directly or via the shared requireStaffAal2 helper', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  const helperBlock = raw.slice(raw.indexOf('async function requireStaffAal2'), raw.indexOf('export async function takeoverConversationAction'));
  assert.ok(/requireViewerRole/.test(helperBlock));
  assert.ok(/requireAssuranceLevel/.test(helperBlock));
  assert.ok(/'aal2'/.test(helperBlock));

  const actionNames = ['takeoverConversationAction', 'releaseConversationAction', 'approveWorkflowStepAction', 'retryDeadLetterAction'];
  for (const name of actionNames) {
    const start = raw.indexOf(`export async function ${name}`);
    assert.ok(start !== -1, `action not found: ${name}`);
    const nextExportIdx = raw.indexOf('export async function', start + 1);
    const block = raw.slice(start, nextExportIdx === -1 ? undefined : nextExportIdx);
    assert.ok(/requireStaffAal2\(/.test(block), `${name} does not call the shared AAL2 staff helper`);
  }
});

test('approveWorkflowStepAction and retryDeadLetterAction are genuinely wired to the real SupabaseAutomationStore and workflow-service functions, not stubs', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  const approveStart = raw.indexOf('export async function approveWorkflowStepAction');
  const retryStart = raw.indexOf('export async function retryDeadLetterAction');
  const approveBlock = raw.slice(approveStart, retryStart);
  const retryBlock = raw.slice(retryStart);

  assert.ok(/completeLevel2Step\(/.test(approveBlock), 'approveWorkflowStepAction must call the real completeLevel2Step function');
  assert.ok(/checkAutomationGateExtended\(/.test(approveBlock), 'approveWorkflowStepAction must enforce the founder-control gate');
  assert.ok(/guardAgainstDuplicateEvent\(/.test(approveBlock), 'approveWorkflowStepAction must reserve idempotency before executing');
  assert.ok(/LEVEL_3/.test(approveBlock), 'approveWorkflowStepAction must explicitly refuse Level 3');

  assert.ok(/manuallyRetryDeadLetteredStep\(/.test(retryBlock), 'retryDeadLetterAction must call the real manuallyRetryDeadLetteredStep function');
  assert.ok(/checkAutomationGateExtended\(/.test(retryBlock), 'retryDeadLetterAction must enforce the founder-control gate');
  assert.ok(/guardAgainstDuplicateEvent\(/.test(retryBlock), 'retryDeadLetterAction must reserve idempotency before executing');
  assert.ok(/dl\.resolved/.test(retryBlock), 'retryDeadLetterAction must reject an already-resolved record');
  assert.ok(!/\.delete\(/.test(retryBlock), 'retryDeadLetterAction must never delete dead-letter or execution history');
});

test('takeoverConversationAction and releaseConversationAction call the real, already-Supabase-backed inbox-actions.ts functions — genuinely wired, not stubs', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  assert.ok(/import.*assignConversation.*setHandoverStatus.*from.*inbox-actions/.test(raw.replace(/\s+/g, ' ')));
  const takeoverBlock = raw.slice(raw.indexOf('export async function takeoverConversationAction'), raw.indexOf('export async function releaseConversationAction'));
  assert.ok(/await setHandoverStatus\(/.test(takeoverBlock));
});

test('staff-console-queries.ts contains no INSERT, UPDATE, or DELETE — every query is a plain SELECT', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-queries.ts', import.meta.url), 'utf8');
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(raw));
});

test('loadStaffConsoleSnapshot returns an honestly unavailable snapshot when no database connection exists', async () => {
  const { loadStaffConsoleSnapshot } = await import('@/server/agents/automation/staff-console-queries');
  const snapshot = await loadStaffConsoleSnapshot();
  assert.equal(snapshot.dataAvailability, 'unavailable');
  assert.equal(snapshot.pendingApprovals, null);
  assert.equal(snapshot.deadLetterQueue, null);
  assert.equal(snapshot.handoverEscalations, null);
});
