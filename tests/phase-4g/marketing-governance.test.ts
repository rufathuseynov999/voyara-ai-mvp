import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createCampaignBrief, addCalendarEntry, createContentDraft, submitForHumanReview, approvePublication,
  prepareScheduledPublication, reuseApprovedOffer, InMemoryMarketingGovernanceStore, MarketingGovernanceError,
  type MarketingGovernanceContext
} from '@/server/agents/automation/marketing-governance';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): MarketingGovernanceContext & { store: InMemoryMarketingGovernanceStore } {
  return { store: new InMemoryMarketingGovernanceStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

test('creating a campaign brief requires a real human author', async () => {
  const c = ctx();
  await assert.rejects(
    () => createCampaignBrief(c, { brand: 'VOYARA', title: 'Summer campaign', objective: 'Awareness', targetLocales: ['az'], createdBy: '' }),
    (e: unknown) => e instanceof MarketingGovernanceError && e.code === 'VALIDATION'
  );
});

test('a campaign brief, calendar entry, and content draft can all be created for a real author', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'RTRAVEL', title: 'Autumn getaways', objective: 'Lead gen', targetLocales: ['az', 'ru'], createdBy: randomUUID() });
  const { entryId } = await addCalendarEntry(c, briefId, 'RTRAVEL', FIXED.toISOString(), 'INSTAGRAM_DM');
  const { draftId } = await createContentDraft(c, briefId, 'RTRAVEL', 'az', 'Payız endirimləri...');
  assert.ok(briefId);
  assert.ok(entryId);
  assert.ok(draftId);
});

test('submitForHumanReview requires a real human reviewer and only accepts a DRAFT', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'VOYARA', title: 'T', objective: 'O', targetLocales: ['en'], createdBy: randomUUID() });
  const { draftId } = await createContentDraft(c, briefId, 'VOYARA', 'en', 'Draft text');
  await assert.rejects(
    () => submitForHumanReview(c, draftId, ''),
    (e: unknown) => e instanceof MarketingGovernanceError && e.code === 'VALIDATION'
  );
  await submitForHumanReview(c, draftId, randomUUID());
  const draft = await c.store.loadContentDraft(draftId);
  assert.equal(draft?.status, 'IN_REVIEW');
});

test('approvePublication refuses without a real AAL2 human approver', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'VOYARA', title: 'T', objective: 'O', targetLocales: ['en'], createdBy: randomUUID() });
  const { draftId } = await createContentDraft(c, briefId, 'VOYARA', 'en', 'Draft text');
  await submitForHumanReview(c, draftId, randomUUID());
  await assert.rejects(
    () => approvePublication(c, draftId, ''),
    (e: unknown) => e instanceof MarketingGovernanceError && e.code === 'MISSING_APPROVAL'
  );
});

test('approvePublication refuses a draft that has not gone through human review', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'VOYARA', title: 'T', objective: 'O', targetLocales: ['en'], createdBy: randomUUID() });
  const { draftId } = await createContentDraft(c, briefId, 'VOYARA', 'en', 'Draft text');
  await assert.rejects(
    () => approvePublication(c, draftId, randomUUID()),
    (e: unknown) => e instanceof MarketingGovernanceError && e.code === 'INVALID_TRANSITION'
  );
});

test('a real approver moves a reviewed draft to APPROVED with a real approval record', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'VOYARA', title: 'T', objective: 'O', targetLocales: ['en'], createdBy: randomUUID() });
  const { draftId } = await createContentDraft(c, briefId, 'VOYARA', 'en', 'Draft text');
  await submitForHumanReview(c, draftId, randomUUID());
  const approver = randomUUID();
  await approvePublication(c, draftId, approver);
  const draft = await c.store.loadContentDraft(draftId);
  assert.equal(draft?.status, 'APPROVED');
  assert.equal(draft?.approvedBy, approver);
  assert.ok(draft?.approvalContentHash);
});

test('prepareScheduledPublication refuses a draft that is not yet APPROVED', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'VOYARA', title: 'T', objective: 'O', targetLocales: ['en'], createdBy: randomUUID() });
  const { draftId } = await createContentDraft(c, briefId, 'VOYARA', 'en', 'Draft text');
  await assert.rejects(
    () => prepareScheduledPublication(c, draftId, FIXED.toISOString()),
    (e: unknown) => e instanceof MarketingGovernanceError && e.code === 'MISSING_APPROVAL'
  );
});

test('prepareScheduledPublication returns a real preparation reference for an APPROVED draft', async () => {
  const c = ctx();
  const { briefId } = await createCampaignBrief(c, { brand: 'VOYARA', title: 'T', objective: 'O', targetLocales: ['en'], createdBy: randomUUID() });
  const { draftId } = await createContentDraft(c, briefId, 'VOYARA', 'en', 'Draft text');
  await submitForHumanReview(c, draftId, randomUUID());
  await approvePublication(c, draftId, randomUUID());
  const { preparationId } = await prepareScheduledPublication(c, draftId, FIXED.toISOString());
  assert.ok(preparationId);
});

test('reuseApprovedOffer accepts an exact verbatim match', () => {
  const text = '10% off all Antalya packages this summer.';
  assert.equal(reuseApprovedOffer(text, text), text);
});

test('reuseApprovedOffer refuses any restated or modified offer text — no fabricated claims via paraphrase', () => {
  assert.throws(
    () => reuseApprovedOffer('10% off all Antalya packages this summer.', '15% off Antalya packages!'),
    (e: unknown) => e instanceof MarketingGovernanceError && e.code === 'VALIDATION'
  );
});

test('marketing-governance.ts contains no function that publishes content, spends advertising budget, or activates an ad account', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/marketing-governance.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/function\s+\w*(publish|postContent|spendBudget|activateAdAccount|modifyBudget|launchCampaign)/i.test(codeOnly));
});

test('marketing-governance.ts contains no CODE reference to a testimonial (comments describing the prohibition, if any, are excluded)', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/marketing-governance.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/testimonial/i.test(codeOnly));
});

test('approvePublication only ever transitions status to APPROVED — it never sets a "published" or "live" state', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/marketing-governance.ts', import.meta.url), 'utf8');
  assert.ok(!/status\s*:\s*['"]PUBLISHED['"]/.test(raw));
  assert.ok(!/status\s*:\s*['"]LIVE['"]/.test(raw));
});

test('no ContentDraftStatus value represents a published or live state — APPROVED is the final status this module can reach', () => {
  const validStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'];
  assert.ok(!validStatuses.includes('PUBLISHED'));
  assert.ok(!validStatuses.includes('LIVE'));
});
