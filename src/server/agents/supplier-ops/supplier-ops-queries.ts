import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Phase 4E — read-only CRM/Founder views over supplier operations. Every
 * function here is a plain SELECT — nothing in this file writes anything.
 * Matches the same AAL2-staff-only read-model pattern already proven for
 * loadAdministrationSnapshot / loadVoiceOperationsMetrics: the caller
 * (a staff page already behind requireAssuranceLevel) is trusted to have
 * enforced authorization; this module only shapes the read.
 */

export type SupplierOpsSnapshot = {
  activeSuppliers: number;
  activeContracts: number;
  expiringContracts: Array<{ contractId: string; contractReference: string; supplierId: string; expiryDate: string | null }>;
  suspendedSuppliers: Array<{ supplierId: string; legalName: string }>;
  portalTasksByStatus: Record<string, number>;
  pendingSupplierConfirmations: number;
  bookingWorkload: { hotelTour: number; airTicketing: number };
  ticketingWorkloadByStatus: Record<string, number>;
  expectedMarginMinorUnits: number;
  realizedMarginMinorUnits: number;
  migrationBatchesByStatus: Record<string, number>;
};

const EMPTY_SNAPSHOT: SupplierOpsSnapshot = {
  activeSuppliers: 0, activeContracts: 0, expiringContracts: [], suspendedSuppliers: [],
  portalTasksByStatus: {}, pendingSupplierConfirmations: 0, bookingWorkload: { hotelTour: 0, airTicketing: 0 },
  ticketingWorkloadByStatus: {}, expectedMarginMinorUnits: 0, realizedMarginMinorUnits: 0, migrationBatchesByStatus: {}
};

const EXPIRY_ALERT_WINDOW_DAYS = 60;

export async function loadSupplierOpsSnapshot(): Promise<SupplierOpsSnapshot> {
  const admin = createAdminSupabaseClient();
  if (!admin) return EMPTY_SNAPSHOT;

  const [
    { count: activeSuppliers },
    { count: activeContracts },
    { data: expiringContractsRaw },
    { data: suspendedSuppliersRaw },
    { data: portalTasksRaw },
    { data: bookingsRaw },
    { data: ticketsRaw },
    { data: migrationBatchesRaw }
  ] = await Promise.all([
    admin.from('suppliers').select('id', { count: 'exact', head: true }).eq('contract_status', 'ACTIVE'),
    admin.from('contracts').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    admin.from('contracts').select('id, contract_reference, supplier_id, expiry_date').eq('status', 'ACTIVE')
      .lte('expiry_date', new Date(Date.now() + EXPIRY_ALERT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)),
    admin.from('suppliers').select('id, legal_name').eq('contract_status', 'SUSPENDED'),
    admin.from('portal_tasks').select('status'),
    admin.from('service_bookings').select('net_cost_minor_units, customer_price_minor_units, expected_margin_minor_units, voucher_status'),
    admin.from('air_ticketing_records').select('ticketing_status'),
    admin.from('migration_batches').select('status')
  ]);

  const portalTasksByStatus: Record<string, number> = {};
  for (const row of portalTasksRaw ?? []) portalTasksByStatus[row.status] = (portalTasksByStatus[row.status] ?? 0) + 1;

  const ticketingWorkloadByStatus: Record<string, number> = {};
  for (const row of ticketsRaw ?? []) ticketingWorkloadByStatus[row.ticketing_status] = (ticketingWorkloadByStatus[row.ticketing_status] ?? 0) + 1;

  const migrationBatchesByStatus: Record<string, number> = {};
  for (const row of migrationBatchesRaw ?? []) migrationBatchesByStatus[row.status] = (migrationBatchesByStatus[row.status] ?? 0) + 1;

  const expectedMarginMinorUnits = (bookingsRaw ?? []).reduce((sum, b) => sum + (b.expected_margin_minor_units ?? 0), 0);
  const realizedMarginMinorUnits = (bookingsRaw ?? []).filter((b) => b.voucher_status === 'ISSUED' || b.voucher_status === 'SENT_TO_CUSTOMER')
    .reduce((sum, b) => sum + (b.expected_margin_minor_units ?? 0), 0);

  return {
    activeSuppliers: activeSuppliers ?? 0,
    activeContracts: activeContracts ?? 0,
    expiringContracts: (expiringContractsRaw ?? []).map((c) => ({ contractId: c.id, contractReference: c.contract_reference, supplierId: c.supplier_id, expiryDate: c.expiry_date })),
    suspendedSuppliers: (suspendedSuppliersRaw ?? []).map((s) => ({ supplierId: s.id, legalName: s.legal_name })),
    portalTasksByStatus,
    pendingSupplierConfirmations: portalTasksByStatus['SUPPLIER_PENDING'] ?? 0,
    bookingWorkload: { hotelTour: (bookingsRaw ?? []).length, airTicketing: (ticketsRaw ?? []).length },
    ticketingWorkloadByStatus,
    expectedMarginMinorUnits,
    realizedMarginMinorUnits,
    migrationBatchesByStatus
  };
}
