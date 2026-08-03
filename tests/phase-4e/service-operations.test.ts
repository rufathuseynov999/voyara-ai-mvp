import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  prepareServiceBooking, recordBookingConfirmation, prepareAirTicketingRecord, recordTicketingStatusChange,
  InMemoryServiceOperationsStore, ServiceOperationsError, type ServiceOpsContext
} from '@/server/agents/supplier-ops/service-operations';
import { InMemorySupplierStore } from '@/server/agents/supplier-ops/in-memory-supplier-store';
import { draftContract, approveAndActivateContract, type ContractServiceContext, type DraftContractInput } from '@/server/agents/supplier-ops/contract-service';
import { ContractAuthorityError } from '@/server/agents/supplier-ops/contract-authority';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): ServiceOpsContext & { store: InMemoryServiceOperationsStore; supplierStore: InMemorySupplierStore } {
  return {
    store: new InMemoryServiceOperationsStore(), supplierStore: new InMemorySupplierStore(),
    correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
}

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

async function activeContract(c: ReturnType<typeof ctx>) {
  const contractCtx: ContractServiceContext = { store: c.supplierStore, correlationId: c.correlationId, now: c.now };
  const supplierId = randomUUID();
  const { contractId } = await draftContract(contractCtx, baseContractInput({ supplierId }));
  await approveAndActivateContract(contractCtx, contractId, randomUUID());
  return { supplierId, contractId };
}

test('preparing a service booking requires an active contract', async () => {
  const c = ctx();
  const contractCtx: ContractServiceContext = { store: c.supplierStore, correlationId: c.correlationId, now: c.now };
  const supplierId = randomUUID();
  const { contractId } = await draftContract(contractCtx, baseContractInput({ supplierId }));
  await assert.rejects(
    () => prepareServiceBooking(c, {
      contactId: randomUUID(), proposalVersionId: null, supplierId, contractId, serviceType: 'HOTEL_ONLY',
      netCostMinorUnits: 10000, customerPriceMinorUnits: 12000, currency: 'AZN', expectedMarginMinorUnits: 2000,
      cancellationTerms: '48h free', responsibleEmployeeId: randomUUID(), portalTaskId: null
    }),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'NOT_ACTIVE'
  );
});

test('a service booking prepared under an active contract starts NOT_ISSUED with no supplier confirmation', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { bookingId } = await prepareServiceBooking(c, {
    contactId: randomUUID(), proposalVersionId: null, supplierId, contractId, serviceType: 'TOUR_PACKAGE',
    netCostMinorUnits: 50000, customerPriceMinorUnits: 65000, currency: 'AZN', expectedMarginMinorUnits: 15000,
    cancellationTerms: '30 days free cancellation', responsibleEmployeeId: randomUUID(), portalTaskId: null
  });
  const booking = await c.store.loadBooking(bookingId);
  assert.equal(booking?.voucherStatus, 'NOT_ISSUED');
  assert.equal(booking?.supplierConfirmation, null);
});

test('recording a booking confirmation without a real reference is refused', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { bookingId } = await prepareServiceBooking(c, {
    contactId: randomUUID(), proposalVersionId: null, supplierId, contractId, serviceType: 'TRANSFER',
    netCostMinorUnits: 3000, customerPriceMinorUnits: 4500, currency: 'AZN', expectedMarginMinorUnits: 1500,
    cancellationTerms: null, responsibleEmployeeId: randomUUID(), portalTaskId: null
  });
  await assert.rejects(
    () => recordBookingConfirmation(c, bookingId, randomUUID(), ''),
    (e: unknown) => e instanceof ServiceOperationsError && e.code === 'VALIDATION'
  );
});

test('recording a real booking confirmation marks the voucher ISSUED', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { bookingId } = await prepareServiceBooking(c, {
    contactId: randomUUID(), proposalVersionId: null, supplierId, contractId, serviceType: 'INSURANCE',
    netCostMinorUnits: 2000, customerPriceMinorUnits: 3000, currency: 'AZN', expectedMarginMinorUnits: 1000,
    cancellationTerms: null, responsibleEmployeeId: randomUUID(), portalTaskId: null
  });
  await recordBookingConfirmation(c, bookingId, randomUUID(), 'INS-CONF-55521');
  const booking = await c.store.loadBooking(bookingId);
  assert.equal(booking?.voucherStatus, 'ISSUED');
  assert.equal(booking?.supplierConfirmation, 'INS-CONF-55521');
});

test('an air-ticketing record can only be prepared starting at PNR_HELD with no human owner yet', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { ticketRecordId } = await prepareAirTicketingRecord(c, {
    contactId: randomUUID(), consolidatorSupplierId: supplierId, contractId, route: 'GYD-IST-GYD',
    passengerNames: ['Test Passenger'], fareBasis: 'YRT', baggage: '1PC 23KG', ticketingDeadline: null,
    netFareMinorUnits: 45000, taxesMinorUnits: 8000, serviceFeeMinorUnits: 2000, customerPriceMinorUnits: 55000,
    currency: 'AZN', changeRefundConditions: 'Non-refundable', pnrReference: 'ABCDEF'
  });
  const record = await c.store.loadTicketRecord(ticketRecordId);
  assert.equal(record?.ticketingStatus, 'PNR_HELD');
  assert.equal(record?.humanTicketingOwnerId, null);
});

test('recording a status change past PNR_HELD requires a real human ticketing owner', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { ticketRecordId } = await prepareAirTicketingRecord(c, {
    contactId: randomUUID(), consolidatorSupplierId: supplierId, contractId, route: 'GYD-DXB-GYD',
    passengerNames: ['Test Passenger'], fareBasis: null, baggage: null, ticketingDeadline: null,
    netFareMinorUnits: 60000, taxesMinorUnits: 10000, serviceFeeMinorUnits: 3000, customerPriceMinorUnits: 73000,
    currency: 'AZN', changeRefundConditions: null, pnrReference: null
  });
  const owner = randomUUID();
  await recordTicketingStatusChange(c, ticketRecordId, 'TICKETED', owner, 'ABCDEF');
  const record = await c.store.loadTicketRecord(ticketRecordId);
  assert.equal(record?.ticketingStatus, 'TICKETED');
  assert.equal(record?.humanTicketingOwnerId, owner);
  assert.equal(record?.pnrReference, 'ABCDEF');
});

test('an empty human ticketing owner id is refused for any status past PNR_HELD', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { ticketRecordId } = await prepareAirTicketingRecord(c, {
    contactId: randomUUID(), consolidatorSupplierId: supplierId, contractId, route: 'GYD-LHR-GYD',
    passengerNames: ['Test Passenger'], fareBasis: null, baggage: null, ticketingDeadline: null,
    netFareMinorUnits: 90000, taxesMinorUnits: 15000, serviceFeeMinorUnits: 5000, customerPriceMinorUnits: 110000,
    currency: 'AZN', changeRefundConditions: null, pnrReference: null
  });
  await assert.rejects(
    () => recordTicketingStatusChange(c, ticketRecordId, 'TICKETED', ''),
    (e: unknown) => e instanceof ServiceOperationsError && e.code === 'REQUIRES_HUMAN_OWNER'
  );
});

test('no function in service-operations.ts issues, voids, reissues, cancels, or refunds a ticket autonomously', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/supplier-ops/service-operations.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/function issueTicket|function voidTicket|function reissueTicket|function cancelBooking|function executeRefund|function chargeCard/i.test(codeOnly));
});

test('recordTicketingStatusChange and recordBookingConfirmation are the two status-changing functions, and both require a human actor parameter', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/supplier-ops/service-operations.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(codeOnly, /export async function recordBookingConfirmation\(\s*ctx: ServiceOpsContext,\s*bookingId: string,\s*confirmedBy: string/);
  assert.match(codeOnly, /export async function recordTicketingStatusChange\(\s*ctx: ServiceOpsContext,\s*ticketRecordId: string,\s*newStatus: Exclude<TicketingStatus, 'PNR_HELD'>,\s*humanTicketingOwnerId: string/);
});
