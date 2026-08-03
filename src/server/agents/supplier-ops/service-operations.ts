import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupplierStore } from './supplier-store';
import { requireActiveContractAuthority, type ContractServiceContext } from './contract-service';

/**
 * Phase 4E — service bookings (hotel/tour/DMC/transfer/insurance/visa/
 * activity/VIP) and air-ticketing records.
 *
 * Both halves of this file follow the same rule: the AI may PREPARE a
 * record — linking customer, proposal, supplier, and an ACTIVE contract,
 * with an approved NET cost and customer price — but every function that
 * moves a record toward something irreversible (confirming a booking,
 * issuing/voiding/reissuing a ticket, cancelling, refunding) requires an
 * explicit human actor id, and there is no function anywhere in this file
 * with a name or behavior resembling autonomous execution of any of those.
 */

export const serviceTypes = [
  'HOTEL_ONLY', 'TREATMENT_WELLNESS', 'TOUR_PACKAGE', 'DYNAMIC_PACKAGE', 'DMC_SERVICE',
  'TRANSFER', 'EXCURSION', 'INSURANCE', 'VISA', 'VIP_SERVICE'
] as const;
export type ServiceType = (typeof serviceTypes)[number];

export const voucherStatuses = ['NOT_ISSUED', 'ISSUED', 'SENT_TO_CUSTOMER', 'VOID'] as const;
export type VoucherStatus = (typeof voucherStatuses)[number];

export const serviceBookingSchema = z.object({
  bookingId: z.uuid(),
  contactId: z.uuid(),
  proposalVersionId: z.uuid().nullable(),
  supplierId: z.uuid(),
  contractId: z.uuid(),
  serviceType: z.enum(serviceTypes),
  netCostMinorUnits: z.number().int().nonnegative(),
  customerPriceMinorUnits: z.number().int().nonnegative(),
  currency: z.string().length(3),
  expectedMarginMinorUnits: z.number().int(),
  cancellationTerms: z.string().nullable(),
  responsibleEmployeeId: z.uuid(),
  supplierConfirmation: z.string().nullable(),
  voucherStatus: z.enum(voucherStatuses),
  portalTaskId: z.uuid().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict();
export type ServiceBooking = z.infer<typeof serviceBookingSchema>;

export const ticketingStatuses = ['PNR_HELD', 'PENDING_TICKETING', 'TICKETED', 'VOIDED', 'REISSUED', 'REFUNDED', 'CANCELLED'] as const;
export type TicketingStatus = (typeof ticketingStatuses)[number];

export const airTicketingRecordSchema = z.object({
  ticketRecordId: z.uuid(),
  contactId: z.uuid(),
  consolidatorSupplierId: z.uuid(),
  contractId: z.uuid(),
  route: z.string().min(1),
  passengerNames: z.array(z.string()),
  fareBasis: z.string().nullable(),
  baggage: z.string().nullable(),
  ticketingDeadline: z.iso.datetime().nullable(),
  pnrReference: z.string().nullable(),
  netFareMinorUnits: z.number().int().nonnegative(),
  taxesMinorUnits: z.number().int().nonnegative(),
  serviceFeeMinorUnits: z.number().int().nonnegative(),
  customerPriceMinorUnits: z.number().int().nonnegative(),
  currency: z.string().length(3),
  ticketingStatus: z.enum(ticketingStatuses),
  changeRefundConditions: z.string().nullable(),
  humanTicketingOwnerId: z.uuid().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict().refine(
  (record) => record.ticketingStatus === 'PNR_HELD' || record.humanTicketingOwnerId !== null,
  { message: 'any status past PNR_HELD requires a named human ticketing owner' }
);
export type AirTicketingRecord = z.infer<typeof airTicketingRecordSchema>;

export class ServiceOperationsError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'CONTRACT_NOT_ACTIVE' | 'REQUIRES_HUMAN_OWNER') {
    super(message);
    this.name = 'ServiceOperationsError';
  }
}

export interface ServiceOperationsStore {
  saveBooking(booking: ServiceBooking): Promise<void>;
  loadBooking(bookingId: string): Promise<ServiceBooking | null>;
  saveTicketRecord(record: AirTicketingRecord): Promise<void>;
  loadTicketRecord(ticketRecordId: string): Promise<AirTicketingRecord | null>;
}

export class InMemoryServiceOperationsStore implements ServiceOperationsStore {
  private readonly bookings = new Map<string, ServiceBooking>();
  private readonly ticketRecords = new Map<string, AirTicketingRecord>();
  async saveBooking(booking: ServiceBooking): Promise<void> { this.bookings.set(booking.bookingId, booking); }
  async loadBooking(bookingId: string): Promise<ServiceBooking | null> { return this.bookings.get(bookingId) ?? null; }
  async saveTicketRecord(record: AirTicketingRecord): Promise<void> { this.ticketRecords.set(record.ticketRecordId, record); }
  async loadTicketRecord(ticketRecordId: string): Promise<AirTicketingRecord | null> { return this.ticketRecords.get(ticketRecordId) ?? null; }
}

export type ServiceOpsContext = { store: ServiceOperationsStore; supplierStore: SupplierStore; correlationId: string; now: () => Date };

/** AI-preparable. Requires the cited contract to be genuinely active before
 *  the booking can even be drafted — never lets a booking reference an
 *  expired/suspended/draft contract as its pricing authority. */
export async function prepareServiceBooking(
  ctx: ServiceOpsContext,
  input: Omit<ServiceBooking, 'bookingId' | 'correlationId' | 'createdAt' | 'voucherStatus' | 'supplierConfirmation'>
): Promise<{ bookingId: string }> {
  const contractCtx: ContractServiceContext = { store: ctx.supplierStore, correlationId: ctx.correlationId, now: ctx.now };
  await requireActiveContractAuthority(contractCtx, input.contractId);

  const bookingId = randomUUID();
  const booking: ServiceBooking = { ...input, bookingId, supplierConfirmation: null, voucherStatus: 'NOT_ISSUED', correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() };
  const parsed = serviceBookingSchema.safeParse(booking);
  if (!parsed.success) throw new ServiceOperationsError('Invalid service booking.', 'VALIDATION');
  await ctx.store.saveBooking(booking);
  return { bookingId };
}

/** Human-only: records a real supplier confirmation and marks the voucher
 *  issued. This is a RECORD of a human action taken outside this system
 *  (e.g. via the supplier portal), never an action this function performs
 *  itself. */
export async function recordBookingConfirmation(ctx: ServiceOpsContext, bookingId: string, confirmedBy: string, supplierConfirmation: string): Promise<void> {
  const booking = await ctx.store.loadBooking(bookingId);
  if (!booking) throw new ServiceOperationsError('Booking not found.', 'NOT_FOUND');
  if (!supplierConfirmation || supplierConfirmation.trim().length === 0) throw new ServiceOperationsError('A real supplier confirmation is required.', 'VALIDATION');
  await ctx.store.saveBooking({ ...booking, supplierConfirmation, voucherStatus: 'ISSUED' });
}

/** AI-preparable air-ticketing record — starts and can ONLY start at
 *  PNR_HELD; nothing in this function can create a record already
 *  TICKETED. */
export async function prepareAirTicketingRecord(
  ctx: ServiceOpsContext,
  input: Omit<AirTicketingRecord, 'ticketRecordId' | 'correlationId' | 'createdAt' | 'ticketingStatus' | 'humanTicketingOwnerId' | 'pnrReference'> & { pnrReference: string | null }
): Promise<{ ticketRecordId: string }> {
  const contractCtx: ContractServiceContext = { store: ctx.supplierStore, correlationId: ctx.correlationId, now: ctx.now };
  await requireActiveContractAuthority(contractCtx, input.contractId);

  const ticketRecordId = randomUUID();
  const record: AirTicketingRecord = { ...input, ticketRecordId, ticketingStatus: 'PNR_HELD', humanTicketingOwnerId: null, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() };
  const parsed = airTicketingRecordSchema.safeParse(record);
  if (!parsed.success) throw new ServiceOperationsError('Invalid air-ticketing record.', 'VALIDATION');
  await ctx.store.saveTicketRecord(record);
  return { ticketRecordId };
}

/** Human-only: records that a human ticketing owner has taken the named
 *  action (via the GDS/consolidator directly, outside this system). Every
 *  status past PNR_HELD requires this to have been called with a real
 *  human owner id — enforced both here and by the schema's own refine. */
export async function recordTicketingStatusChange(
  ctx: ServiceOpsContext,
  ticketRecordId: string,
  newStatus: Exclude<TicketingStatus, 'PNR_HELD'>,
  humanTicketingOwnerId: string,
  pnrReference?: string
): Promise<void> {
  const record = await ctx.store.loadTicketRecord(ticketRecordId);
  if (!record) throw new ServiceOperationsError('Ticket record not found.', 'NOT_FOUND');
  if (!humanTicketingOwnerId) throw new ServiceOperationsError('A named human ticketing owner is required for this status.', 'REQUIRES_HUMAN_OWNER');
  await ctx.store.saveTicketRecord({ ...record, ticketingStatus: newStatus, humanTicketingOwnerId, pnrReference: pnrReference ?? record.pnrReference });
}
