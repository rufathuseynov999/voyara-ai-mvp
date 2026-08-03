import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { rankSuppliers, type RankingCandidate, type RankingContext } from '@/server/agents/supplier-ops/supplier-ranking';
import { InMemorySupplierStore } from '@/server/agents/supplier-ops/in-memory-supplier-store';
import { draftContract, approveAndActivateContract, type ContractServiceContext, type DraftContractInput } from '@/server/agents/supplier-ops/contract-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function baseContractInput(overrides: Partial<DraftContractInput> = {}): DraftContractInput {
  return {
    agreementType: 'NET_RATE', rtravelLegalEntity: 'R-Travel LLC', supplierId: randomUUID(),
    supplierLegalEntity: 'Test Supplier LLC', contractReference: `REF-${randomUUID().slice(0, 8)}`,
    effectiveDate: '2026-01-01', expiryDate: '2027-01-01', renewalConditions: null, territory: 'Azerbaijan',
    productsCovered: ['HOTEL'], pricingStructure: 'NET rate + markup', markupRules: { defaultPercent: 15 },
    minimumAdvertisedPriceRestriction: null, currency: 'AZN', paymentTerms: 'Net 30', depositOrCreditLineRequirement: null,
    cancellationRules: '48h free cancellation', refundResponsibility: 'Supplier', chargebackResponsibility: 'R-Travel',
    bookingVoucherRequirements: null, resalePermissions: {}, voyaraBrandingAllowed: true, rtravelIdentityRequired: true,
    confidentialityRestrictions: null,
    ...overrides
  };
}

async function activeContract(store: InMemorySupplierStore) {
  const contractCtx: ContractServiceContext = { store, correlationId: 'corr-test', now: () => FIXED };
  const supplierId = randomUUID();
  const { contractId } = await draftContract(contractCtx, baseContractInput({ supplierId }));
  await approveAndActivateContract(contractCtx, contractId, randomUUID());
  return { supplierId, contractId };
}

test('a supplier with no active contract is excluded entirely, not ranked last', async () => {
  const store = new InMemorySupplierStore();
  const contractCtx: ContractServiceContext = { store, correlationId: 'corr-test', now: () => FIXED };
  const supplierId = randomUUID();
  const { contractId } = await draftContract(contractCtx, baseContractInput({ supplierId }));

  const rankCtx: RankingContext = { store, now: () => FIXED };
  const { ranked, excluded } = await rankSuppliers(rankCtx, [
    { supplierId, contractId, supplierType: 'HOTEL_WHOLESALER', destination: 'Baku', netPriceMinorUnits: 10000, availabilitySource: 'PORTAL', cancellationFlexibilityScore: 80, historicalReliabilityScore: 90, riskStatus: 'LOW', customerPreferredSupplierId: null }
  ], 'Baku', null);
  assert.equal(ranked.length, 0);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].supplierId, supplierId);
});

test('a supplier with an active contract for the wrong destination is excluded', async () => {
  const store = new InMemorySupplierStore();
  const { supplierId, contractId } = await activeContract(store);
  const rankCtx: RankingContext = { store, now: () => FIXED };
  const { ranked, excluded } = await rankSuppliers(rankCtx, [
    { supplierId, contractId, supplierType: 'HOTEL_WHOLESALER', destination: 'Istanbul', netPriceMinorUnits: 10000, availabilitySource: 'PORTAL', cancellationFlexibilityScore: 80, historicalReliabilityScore: 90, riskStatus: 'LOW', customerPreferredSupplierId: null }
  ], 'Baku', null);
  assert.equal(ranked.length, 0);
  assert.ok(excluded[0].reason.includes('destination'));
});

test('lower NET price scores higher, and the explanation names the real availability source', async () => {
  const store = new InMemorySupplierStore();
  const cheap = await activeContract(store);
  const expensive = await activeContract(store);
  const rankCtx: RankingContext = { store, now: () => FIXED };
  const candidates: RankingCandidate[] = [
    { supplierId: cheap.supplierId, contractId: cheap.contractId, supplierType: 'HOTEL_WHOLESALER', destination: 'Baku', netPriceMinorUnits: 5000, availabilitySource: 'API', cancellationFlexibilityScore: 50, historicalReliabilityScore: 50, riskStatus: 'LOW', customerPreferredSupplierId: null },
    { supplierId: expensive.supplierId, contractId: expensive.contractId, supplierType: 'HOTEL_WHOLESALER', destination: 'Baku', netPriceMinorUnits: 50000, availabilitySource: 'PORTAL', cancellationFlexibilityScore: 50, historicalReliabilityScore: 50, riskStatus: 'LOW', customerPreferredSupplierId: null }
  ];
  const { ranked } = await rankSuppliers(rankCtx, candidates, 'Baku', null);
  assert.equal(ranked[0].supplierId, cheap.supplierId);
  assert.equal(ranked[0].explanation.availabilitySource, 'API');
});

test('missing data is honestly reported as unavailable, never fabricated', async () => {
  const store = new InMemorySupplierStore();
  const { supplierId, contractId } = await activeContract(store);
  const rankCtx: RankingContext = { store, now: () => FIXED };
  const { ranked } = await rankSuppliers(rankCtx, [
    { supplierId, contractId, supplierType: 'HOTEL_WHOLESALER', destination: 'Baku', netPriceMinorUnits: null, availabilitySource: 'UNAVAILABLE', cancellationFlexibilityScore: null, historicalReliabilityScore: null, riskStatus: 'UNDER_REVIEW', customerPreferredSupplierId: null }
  ], 'Baku', null);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].explanation.netPriceMinorUnits, null);
  assert.ok(ranked[0].explanation.dataUnavailable.some((d) => d.includes('NET price')));
  assert.ok(ranked[0].explanation.dataUnavailable.some((d) => d.includes('Availability could not be confirmed')));
});

test('a HIGH risk supplier is penalized but not excluded, since the contract itself is still active', async () => {
  const store = new InMemorySupplierStore();
  const { supplierId, contractId } = await activeContract(store);
  const rankCtx: RankingContext = { store, now: () => FIXED };
  const { ranked, excluded } = await rankSuppliers(rankCtx, [
    { supplierId, contractId, supplierType: 'DMC', destination: 'Baku', netPriceMinorUnits: 10000, availabilitySource: 'EMAIL', cancellationFlexibilityScore: 60, historicalReliabilityScore: 60, riskStatus: 'HIGH', customerPreferredSupplierId: null }
  ], 'Baku', null);
  assert.equal(excluded.length, 0);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].explanation.reasonsSelected.some((r) => r.includes('HIGH')));
});

test('customer preference is reflected transparently in the explanation', async () => {
  const store = new InMemorySupplierStore();
  const { supplierId, contractId } = await activeContract(store);
  const rankCtx: RankingContext = { store, now: () => FIXED };
  const { ranked } = await rankSuppliers(rankCtx, [
    { supplierId, contractId, supplierType: 'TOUR_OPERATOR', destination: 'Baku', netPriceMinorUnits: 10000, availabilitySource: 'API', cancellationFlexibilityScore: 50, historicalReliabilityScore: 50, riskStatus: 'LOW', customerPreferredSupplierId: supplierId }
  ], 'Baku', supplierId);
  assert.ok(ranked[0].explanation.reasonsSelected.some((r) => r.includes('preferred supplier')));
});
