import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createCorporateAccount, addCorporateSeat, removeCorporateSeat, suspendCorporateAccount, isAuthorizedTravellerForAccount,
  InMemoryCorporateMembershipStore, CorporateMembershipError, type CorporateMembershipContext
} from '@/server/agents/subscriptions/corporate-membership-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): CorporateMembershipContext & { store: InMemoryCorporateMembershipStore } {
  return { store: new InMemoryCorporateMembershipStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function baseAccount(c: ReturnType<typeof ctx>, authorizedUserLimit: number | null = 5) {
  const { corporateAccountId } = await createCorporateAccount(c, {
    legalEntityName: 'Test Corp LLC', billingContact: { name: 'Finance Team', email: 'finance@testcorp.example' },
    accountOwnerContactId: randomUUID(), planVersionId: null, authorizedUserLimit, enterpriseContractReference: null
  });
  return corporateAccountId;
}

test('creating a corporate account succeeds and starts unsuspended', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c);
  const account = await c.store.loadAccount(corporateAccountId);
  assert.equal(account?.suspended, false);
  assert.equal(account?.legalEntityName, 'Test Corp LLC');
});

test('adding seats up to the authorized limit succeeds', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c, 2);
  await addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER');
  await addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER');
  const seats = await c.store.loadSeatsForAccount(corporateAccountId);
  assert.equal(seats.length, 2);
});

test('adding a seat beyond the authorized limit is refused', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c, 1);
  await addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER');
  await assert.rejects(
    () => addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER'),
    (e: unknown) => e instanceof CorporateMembershipError && e.code === 'SEAT_LIMIT_REACHED'
  );
});

test('a null authorizedUserLimit means unlimited seats', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c, null);
  for (let i = 0; i < 10; i++) {
    await addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER');
  }
  const seats = await c.store.loadSeatsForAccount(corporateAccountId);
  assert.equal(seats.length, 10);
});

test('a removed (inactive) seat does not count against the limit, freeing space for a new one', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c, 1);
  const { seatId } = await addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER');
  await removeCorporateSeat(c, corporateAccountId, seatId);
  await addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER');
});

test('a duplicate seat for the same traveller on the same account is refused', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c, 5);
  const travellerContactId = randomUUID();
  await addCorporateSeat(c, corporateAccountId, travellerContactId, 'TRAVELLER');
  await assert.rejects(
    () => addCorporateSeat(c, corporateAccountId, travellerContactId, 'TRAVELLER'),
    (e: unknown) => e instanceof CorporateMembershipError && e.code === 'DUPLICATE_SEAT'
  );
});

test('a traveller with a seat on account A is NOT authorized on account B', async () => {
  const c = ctx();
  const accountA = await baseAccount(c);
  const accountB = await baseAccount(c);
  const traveller = randomUUID();
  await addCorporateSeat(c, accountA, traveller, 'TRAVELLER');
  assert.equal(await isAuthorizedTravellerForAccount(c, accountA, traveller), true);
  assert.equal(await isAuthorizedTravellerForAccount(c, accountB, traveller), false);
});

test('seats loaded for account A never include a seat that belongs to account B', async () => {
  const c = ctx();
  const accountA = await baseAccount(c);
  const accountB = await baseAccount(c);
  await addCorporateSeat(c, accountA, randomUUID(), 'TRAVELLER');
  await addCorporateSeat(c, accountB, randomUUID(), 'TRAVELLER');
  const seatsA = await c.store.loadSeatsForAccount(accountA);
  const seatsB = await c.store.loadSeatsForAccount(accountB);
  assert.equal(seatsA.length, 1);
  assert.equal(seatsB.length, 1);
  assert.notEqual(seatsA[0].corporateAccountId, seatsB[0].corporateAccountId);
});

test('suspending a corporate account requires a real human actor id', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c);
  await assert.rejects(
    () => suspendCorporateAccount(c, corporateAccountId, ''),
    (e: unknown) => e instanceof CorporateMembershipError && e.code === 'VALIDATION'
  );
});

test('a suspended corporate account refuses new seats', async () => {
  const c = ctx();
  const corporateAccountId = await baseAccount(c);
  await suspendCorporateAccount(c, corporateAccountId, randomUUID());
  await assert.rejects(
    () => addCorporateSeat(c, corporateAccountId, randomUUID(), 'TRAVELLER'),
    (e: unknown) => e instanceof CorporateMembershipError && e.code === 'SUSPENDED'
  );
});

test('an Enterprise corporate account is priced via enterpriseContractReference, never a plan-version price', async () => {
  const c = ctx();
  const { corporateAccountId } = await createCorporateAccount(c, {
    legalEntityName: 'Big Enterprise Client LLC', billingContact: { name: 'CFO', email: 'cfo@bigclient.example' },
    accountOwnerContactId: randomUUID(), planVersionId: null, authorizedUserLimit: 100, enterpriseContractReference: 'ENT-CONTRACT-2026-001'
  });
  const account = await c.store.loadAccount(corporateAccountId);
  assert.equal(account?.enterpriseContractReference, 'ENT-CONTRACT-2026-001');
  assert.equal(account?.planVersionId, null);
});
