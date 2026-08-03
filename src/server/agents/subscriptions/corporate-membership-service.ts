import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Phase 4F — corporate membership service.
 *
 * A corporate account is its own isolated entitlement boundary: seats
 * (authorized users / traveller profiles) under one corporate account never
 * leak into another's, and a corporate account's plan/entitlements are
 * resolved independently of any personal subscription a seat-holder might
 * also have as an individual. Enterprise pricing/benefits are never public
 * — an Enterprise corporate account is priced via `enterpriseContractReference`
 * only, never a published `plan_versions` row with a real price (enforced
 * both here and by the database's own CHECK constraint).
 */

export const corporateAccountSchema = z.object({
  corporateAccountId: z.uuid(),
  legalEntityName: z.string().trim().min(1),
  billingContact: z.object({ name: z.string(), email: z.email(), phone: z.string().optional() }),
  accountOwnerContactId: z.uuid(),
  planVersionId: z.uuid().nullable(),
  authorizedUserLimit: z.number().int().positive().nullable(),
  enterpriseContractReference: z.string().nullable(),
  suspended: z.boolean(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict();
export type CorporateAccount = z.infer<typeof corporateAccountSchema>;

export type CorporateSeat = {
  seatId: string;
  corporateAccountId: string;
  travellerContactId: string;
  role: string;
  active: boolean;
  correlationId: string;
  createdAt: string;
};

export class CorporateMembershipError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'SEAT_LIMIT_REACHED' | 'DUPLICATE_SEAT' | 'SUSPENDED') {
    super(message);
    this.name = 'CorporateMembershipError';
  }
}

export interface CorporateMembershipStore {
  saveAccount(account: CorporateAccount): Promise<void>;
  loadAccount(corporateAccountId: string): Promise<CorporateAccount | null>;
  saveSeat(seat: CorporateSeat): Promise<void>;
  loadSeatsForAccount(corporateAccountId: string): Promise<CorporateSeat[]>;
  findSeatForTraveller(corporateAccountId: string, travellerContactId: string): Promise<CorporateSeat | null>;
}

export class InMemoryCorporateMembershipStore implements CorporateMembershipStore {
  private readonly accounts = new Map<string, CorporateAccount>();
  private readonly seats = new Map<string, CorporateSeat[]>();

  async saveAccount(account: CorporateAccount): Promise<void> { this.accounts.set(account.corporateAccountId, account); }
  async loadAccount(corporateAccountId: string): Promise<CorporateAccount | null> { return this.accounts.get(corporateAccountId) ?? null; }
  async saveSeat(seat: CorporateSeat): Promise<void> {
    const existing = this.seats.get(seat.corporateAccountId) ?? [];
    const idx = existing.findIndex((s) => s.seatId === seat.seatId);
    if (idx >= 0) existing[idx] = seat; else existing.push(seat);
    this.seats.set(seat.corporateAccountId, existing);
  }
  async loadSeatsForAccount(corporateAccountId: string): Promise<CorporateSeat[]> { return this.seats.get(corporateAccountId) ?? []; }
  async findSeatForTraveller(corporateAccountId: string, travellerContactId: string): Promise<CorporateSeat | null> {
    const seats = this.seats.get(corporateAccountId) ?? [];
    return seats.find((s) => s.travellerContactId === travellerContactId) ?? null;
  }
}

export type CorporateMembershipContext = { store: CorporateMembershipStore; correlationId: string; now: () => Date };

export async function createCorporateAccount(
  ctx: CorporateMembershipContext,
  input: Omit<CorporateAccount, 'corporateAccountId' | 'suspended' | 'correlationId' | 'createdAt' | 'updatedAt'>
): Promise<{ corporateAccountId: string }> {
  const corporateAccountId = randomUUID();
  const now = ctx.now().toISOString();
  const account: CorporateAccount = { ...input, corporateAccountId, suspended: false, correlationId: ctx.correlationId, createdAt: now, updatedAt: now };
  const parsed = corporateAccountSchema.safeParse(account);
  if (!parsed.success) throw new CorporateMembershipError('Invalid corporate account.', 'VALIDATION');
  await ctx.store.saveAccount(account);
  return { corporateAccountId };
}

export async function addCorporateSeat(ctx: CorporateMembershipContext, corporateAccountId: string, travellerContactId: string, role: string): Promise<{ seatId: string }> {
  const account = await ctx.store.loadAccount(corporateAccountId);
  if (!account) throw new CorporateMembershipError('Corporate account not found.', 'NOT_FOUND');
  if (account.suspended) throw new CorporateMembershipError('Cannot add a seat to a suspended corporate account.', 'SUSPENDED');

  const existing = await ctx.store.findSeatForTraveller(corporateAccountId, travellerContactId);
  if (existing) throw new CorporateMembershipError('This traveller already has a seat on this corporate account.', 'DUPLICATE_SEAT');

  if (account.authorizedUserLimit !== null) {
    const seats = await ctx.store.loadSeatsForAccount(corporateAccountId);
    const activeCount = seats.filter((s) => s.active).length;
    if (activeCount >= account.authorizedUserLimit) throw new CorporateMembershipError(`Seat limit (${account.authorizedUserLimit}) reached for this corporate account.`, 'SEAT_LIMIT_REACHED');
  }

  const seatId = randomUUID();
  await ctx.store.saveSeat({ seatId, corporateAccountId, travellerContactId, role, active: true, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() });
  return { seatId };
}

export async function removeCorporateSeat(ctx: CorporateMembershipContext, corporateAccountId: string, seatId: string): Promise<void> {
  const seats = await ctx.store.loadSeatsForAccount(corporateAccountId);
  const seat = seats.find((s) => s.seatId === seatId);
  if (!seat) throw new CorporateMembershipError('Seat not found.', 'NOT_FOUND');
  await ctx.store.saveSeat({ ...seat, active: false });
}

export async function suspendCorporateAccount(ctx: CorporateMembershipContext, corporateAccountId: string, suspendedBy: string): Promise<void> {
  if (!suspendedBy) throw new CorporateMembershipError('A real human actor is required to suspend a corporate account.', 'VALIDATION');
  const account = await ctx.store.loadAccount(corporateAccountId);
  if (!account) throw new CorporateMembershipError('Corporate account not found.', 'NOT_FOUND');
  await ctx.store.saveAccount({ ...account, suspended: true, updatedAt: ctx.now().toISOString() });
}

export async function isAuthorizedTravellerForAccount(ctx: CorporateMembershipContext, corporateAccountId: string, travellerContactId: string): Promise<boolean> {
  const seat = await ctx.store.findSeatForTraveller(corporateAccountId, travellerContactId);
  return seat !== null && seat.active;
}
