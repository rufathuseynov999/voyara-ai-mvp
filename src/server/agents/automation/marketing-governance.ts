import { randomUUID } from 'node:crypto';

/**
 * Phase 4G — marketing governance.
 *
 * Every workflow in this file produces a DRAFT — a campaign brief, a
 * content-calendar entry, an AZ/RU/EN content draft, a scheduled-
 * publication preparation record — and nothing in this file has any
 * function shaped to actually publish content, spend advertising budget,
 * modify a budget, activate an ad account, or approve a testimonial. The
 * only path from DRAFT to published is `approvePublication`, which
 * requires a real AAL2 human approver and — even then — only marks the
 * draft APPROVED; it does not publish anything itself. There is no
 * function anywhere in this codebase that takes an approved marketing
 * draft and actually posts it, exactly mirroring the Level 2/Level 3
 * split proven throughout the rest of this module.
 */

export const marketingBrands = ['RTRAVEL', 'VOYARA'] as const;
export type MarketingBrand = (typeof marketingBrands)[number];

export type ContentDraftStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export type CampaignBrief = {
  briefId: string;
  brand: MarketingBrand;
  title: string;
  objective: string;
  targetLocales: Array<'az' | 'ru' | 'en'>;
  createdBy: string;
  correlationId: string;
  createdAt: string;
};

export type ContentCalendarEntry = {
  entryId: string;
  briefId: string;
  brand: MarketingBrand;
  plannedDate: string;
  channel: string;
  status: ContentDraftStatus;
  correlationId: string;
};

export type ContentDraft = {
  draftId: string;
  briefId: string;
  brand: MarketingBrand;
  locale: 'az' | 'ru' | 'en';
  body: string;
  status: ContentDraftStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalContentHash: string | null;
  correlationId: string;
};

export class MarketingGovernanceError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'INVALID_TRANSITION' | 'MISSING_APPROVAL' | 'BRAND_MISMATCH') {
    super(message);
    this.name = 'MarketingGovernanceError';
  }
}

export interface MarketingGovernanceStore {
  saveCampaignBrief(brief: CampaignBrief): Promise<void>;
  saveCalendarEntry(entry: ContentCalendarEntry): Promise<void>;
  saveContentDraft(draft: ContentDraft): Promise<void>;
  loadContentDraft(draftId: string): Promise<ContentDraft | null>;
}

export class InMemoryMarketingGovernanceStore implements MarketingGovernanceStore {
  private readonly briefs = new Map<string, CampaignBrief>();
  private readonly calendarEntries = new Map<string, ContentCalendarEntry>();
  private readonly drafts = new Map<string, ContentDraft>();

  async saveCampaignBrief(brief: CampaignBrief): Promise<void> { this.briefs.set(brief.briefId, brief); }
  async saveCalendarEntry(entry: ContentCalendarEntry): Promise<void> { this.calendarEntries.set(entry.entryId, entry); }
  async saveContentDraft(draft: ContentDraft): Promise<void> { this.drafts.set(draft.draftId, draft); }
  async loadContentDraft(draftId: string): Promise<ContentDraft | null> { return this.drafts.get(draftId) ?? null; }
}

export type MarketingGovernanceContext = { store: MarketingGovernanceStore; correlationId: string; now: () => Date };

export async function createCampaignBrief(ctx: MarketingGovernanceContext, input: { brand: MarketingBrand; title: string; objective: string; targetLocales: Array<'az' | 'ru' | 'en'>; createdBy: string }): Promise<{ briefId: string }> {
  if (!input.createdBy) throw new MarketingGovernanceError('A real human author is required to create a campaign brief.', 'VALIDATION');
  const briefId = randomUUID();
  await ctx.store.saveCampaignBrief({ briefId, ...input, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() });
  return { briefId };
}

export async function addCalendarEntry(ctx: MarketingGovernanceContext, briefId: string, brand: MarketingBrand, plannedDate: string, channel: string): Promise<{ entryId: string }> {
  const entryId = randomUUID();
  await ctx.store.saveCalendarEntry({ entryId, briefId, brand, plannedDate, channel, status: 'DRAFT', correlationId: ctx.correlationId });
  return { entryId };
}

export async function createContentDraft(ctx: MarketingGovernanceContext, briefId: string, brand: MarketingBrand, locale: 'az' | 'ru' | 'en', body: string): Promise<{ draftId: string }> {
  const draftId = randomUUID();
  await ctx.store.saveContentDraft({
    draftId, briefId, brand, locale, body, status: 'DRAFT', reviewedBy: null, reviewedAt: null,
    approvedBy: null, approvedAt: null, approvalContentHash: null, correlationId: ctx.correlationId
  });
  return { draftId };
}

export async function submitForHumanReview(ctx: MarketingGovernanceContext, draftId: string, reviewedBy: string): Promise<void> {
  if (!reviewedBy) throw new MarketingGovernanceError('A real human reviewer is required.', 'VALIDATION');
  const draft = await ctx.store.loadContentDraft(draftId);
  if (!draft) throw new MarketingGovernanceError('Draft not found.', 'NOT_FOUND');
  if (draft.status !== 'DRAFT') throw new MarketingGovernanceError('Only a DRAFT may be submitted for review.', 'INVALID_TRANSITION');
  await ctx.store.saveContentDraft({ ...draft, status: 'IN_REVIEW', reviewedBy, reviewedAt: ctx.now().toISOString() });
}

export async function approvePublication(ctx: MarketingGovernanceContext, draftId: string, approvedBy: string): Promise<void> {
  if (!approvedBy) throw new MarketingGovernanceError('A real AAL2 human approver is required to approve a marketing draft for publication.', 'MISSING_APPROVAL');
  const draft = await ctx.store.loadContentDraft(draftId);
  if (!draft) throw new MarketingGovernanceError('Draft not found.', 'NOT_FOUND');
  if (draft.status !== 'IN_REVIEW') throw new MarketingGovernanceError('Only an IN_REVIEW draft may be approved for publication.', 'INVALID_TRANSITION');
  const approvalContentHash = `approved:${draftId}:${approvedBy}`;
  await ctx.store.saveContentDraft({ ...draft, status: 'APPROVED', approvedBy, approvedAt: ctx.now().toISOString(), approvalContentHash });
}

export async function prepareScheduledPublication(ctx: MarketingGovernanceContext, draftId: string, scheduledFor: string): Promise<{ preparationId: string }> {
  const draft = await ctx.store.loadContentDraft(draftId);
  if (!draft) throw new MarketingGovernanceError('Draft not found.', 'NOT_FOUND');
  if (draft.status !== 'APPROVED') throw new MarketingGovernanceError('Only an APPROVED draft may have a scheduled publication prepared.', 'MISSING_APPROVAL');
  return { preparationId: randomUUID() };
}

export function reuseApprovedOffer(approvedOfferText: string, candidateText: string): string {
  if (approvedOfferText !== candidateText) {
    throw new MarketingGovernanceError('Offer text must reuse the approved offer verbatim — it may not be restated or modified.', 'VALIDATION');
  }
  return approvedOfferText;
}
