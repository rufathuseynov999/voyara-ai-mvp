import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  approveAndActivateContract, draftContract, requireActiveContractAuthority, reviseContract,
  type ContractServiceContext, type DraftContractInput
} from '@/server/agents/supplier-ops/contract-service';
import { InMemorySupplierStore } from '@/server/agents/supplier-ops/in-memory-supplier-store';
import { ContractAuthorityError } from '@/server/agents/supplier-ops/contract-authority';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): ContractServiceContext & { store: InMemorySupplierStore } {
  return { store: new InMemorySupplierStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function baseContractInput(overrides: Partial<DraftContractInput> = {}): DraftContractInput {
  return {
    agreementType: 'NET_RATE', rtravelLegalEntity: 'R-Travel LLC', supplierId: randomUUID(),
    supplierLegalEntity: 'Test Hotel Wholesaler LLC', contractReference: `REF-${randomUUID().slice(0, 8)}`,
    effectiveDate: '2026-01-01', expiryDate: '2027-01-01', renewalConditions: null, territory: 'Azerbaijan',
    productsCovered: ['HOTEL'], pricingStructure: 'NET rate + markup', markupRules: { defaultPercent: 15 },
    minimumAdvertisedPriceRestriction: null, currency: 'AZN', paymentTerms: 'Net 30', depositOrCreditLineRequirement: null,
    cancellationRules: '48h free cancellation', refundResponsibility: 'Supplier', chargebackResponsibility: 'R-Travel',
    bookingVoucherRequirements: null, resalePermissions: {}, voyaraBrandingAllowed: true, rtravelIdentityRequired: true,
    confidentialityRestrictions: null,
    ...overrides
  };
}

test('drafting a contract succeeds and starts in DRAFT status', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  const contract = await c.store.loadContract(contractId);
  assert.equal(contract?.status, 'DRAFT');
  assert.equal(contract?.version, 1);
  assert.equal(contract?.approvedBy, null);
});

test('a duplicate contract reference is refused', async () => {
  const c = ctx();
  const input = baseContractInput({ contractReference: 'DUPLICATE-REF-001' });
  await draftContract(c, input);
  await assert.rejects(
    () => draftContract(c, baseContractInput({ contractReference: 'DUPLICATE-REF-001' })),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'DUPLICATE_REFERENCE'
  );
});

test('approving a contract sets it ACTIVE with a real approver, timestamp, and content hash', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  const approverId = randomUUID();
  await approveAndActivateContract(c, contractId, approverId);
  const contract = await c.store.loadContract(contractId);
  assert.equal(contract?.status, 'ACTIVE');
  assert.equal(contract?.approvedBy, approverId);
  assert.ok(contract?.contentHash);
  const versions = c.store.contractVersionsFor(contractId);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].createdBy, approverId);
});

test('a DRAFT contract cannot authorize an operation', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await assert.rejects(
    () => requireActiveContractAuthority(c, contractId),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'NOT_ACTIVE'
  );
});

test('a genuinely ACTIVE contract authorizes an operation', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await approveAndActivateContract(c, contractId, randomUUID());
  const contract = await requireActiveContractAuthority(c, contractId);
  assert.equal(contract.status, 'ACTIVE');
});

test('a SUSPENDED contract cannot authorize an operation, even if it was previously active', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await approveAndActivateContract(c, contractId, randomUUID());
  const active = await c.store.loadContract(contractId);
  await c.store.saveContract({ ...active!, status: 'SUSPENDED' });
  await assert.rejects(
    () => requireActiveContractAuthority(c, contractId),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'SUSPENDED'
  );
});

test('an EXPIRED contract cannot authorize an operation', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await approveAndActivateContract(c, contractId, randomUUID());
  const active = await c.store.loadContract(contractId);
  await c.store.saveContract({ ...active!, status: 'EXPIRED' });
  await assert.rejects(
    () => requireActiveContractAuthority(c, contractId),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'EXPIRED'
  );
});

test('a contract past its own expiryDate refuses authority even while formally still marked ACTIVE', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput({ expiryDate: '2026-07-01' }));
  await approveAndActivateContract(c, contractId, randomUUID());
  await assert.rejects(
    () => requireActiveContractAuthority(c, contractId),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'EXPIRED'
  );
});

test('a contract whose stored hash no longer matches its own content is refused (stale-hash discipline)', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await approveAndActivateContract(c, contractId, randomUUID());
  const active = await c.store.loadContract(contractId);
  await c.store.saveContract({ ...active!, pricingStructure: 'Tampered pricing structure' });
  await assert.rejects(
    () => requireActiveContractAuthority(c, contractId),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'STALE_HASH'
  );
});

test('revising a contract appends a new version and reverts to DRAFT, requiring re-approval', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await approveAndActivateContract(c, contractId, randomUUID());
  const { newVersion } = await reviseContract(c, contractId, { pricingStructure: 'Revised NET rate + 18% markup' }, randomUUID());
  assert.equal(newVersion, 2);
  const revised = await c.store.loadContract(contractId);
  assert.equal(revised?.status, 'DRAFT');
  assert.equal(revised?.approvedBy, null);
  await assert.rejects(() => requireActiveContractAuthority(c, contractId), (e: unknown) => e instanceof ContractAuthorityError && e.code === 'NOT_ACTIVE');
});

test('re-approving a revised contract produces a second immutable version row, not a mutation of the first', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput());
  await approveAndActivateContract(c, contractId, randomUUID());
  await reviseContract(c, contractId, { pricingStructure: 'Revised pricing' }, randomUUID());
  await approveAndActivateContract(c, contractId, randomUUID());
  const versions = c.store.contractVersionsFor(contractId);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[1].version, 2);
  assert.notEqual(versions[0].contentHash, versions[1].contentHash);
});

test('draftContract never fabricates a value for a field the caller left null', async () => {
  const c = ctx();
  const { contractId } = await draftContract(c, baseContractInput({ minimumAdvertisedPriceRestriction: null, confidentialityRestrictions: null }));
  const contract = await c.store.loadContract(contractId);
  assert.equal(contract?.minimumAdvertisedPriceRestriction, null);
  assert.equal(contract?.confidentialityRestrictions, null);
});
