import { z } from 'zod';

/**
 * Phase 4E — supplier/partner registry contract.
 *
 * R-Travel remains the legal merchant, supplier-contract authority, booking
 * authority, invoicing authority, and refund/chargeback authority
 * throughout everything in this module, until founder configuration and new
 * contracts explicitly change this — nothing in this contract or the
 * services built on it grants the AI any of that authority.
 */

export const supplierTypes = [
  'HOTEL_WHOLESALER', 'DIRECT_HOTEL', 'HOTEL_CHAIN', 'TOUR_OPERATOR', 'DMC',
  'AIRLINE_CONSOLIDATOR', 'GDS_PROVIDER', 'NDC_PROVIDER', 'TRAVEL_AGENCY', 'SUB_AGENCY',
  'TRANSFER_PROVIDER', 'INSURANCE_PROVIDER', 'VISA_SERVICE', 'ACTIVITY_PROVIDER',
  'CAR_RENTAL', 'VIP_CONCIERGE', 'CORPORATE_TRAVEL_PARTNER'
] as const;
export type SupplierType = (typeof supplierTypes)[number];

export const integrationStatuses = ['NO_INTEGRATION', 'PORTAL_ONLY', 'API_AVAILABLE', 'API_INTEGRATED'] as const;
export type IntegrationStatus = (typeof integrationStatuses)[number];

export const contractStatuses = ['DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'] as const;
export type ContractStatusValue = (typeof contractStatuses)[number];

export const supplierRiskStatuses = ['LOW', 'MEDIUM', 'HIGH', 'UNDER_REVIEW'] as const;
export type SupplierRiskStatus = (typeof supplierRiskStatuses)[number];

const contactSchema = z.object({ name: z.string(), role: z.string().optional(), email: z.email().optional(), phone: z.string().optional() }).strict();

export const supplierSchema = z.object({
  supplierId: z.uuid(),
  legalName: z.string().trim().min(1).max(300),
  tradingName: z.string().trim().max(300).nullable(),
  supplierType: z.enum(supplierTypes),
  countries: z.array(z.string()),
  destinations: z.array(z.string()),
  currencies: z.array(z.string()),
  languages: z.array(z.string()),
  accountManagerId: z.uuid().nullable(),
  operationalContacts: z.array(contactSchema),
  financeContacts: z.array(contactSchema),
  emergencyContacts: z.array(contactSchema),
  portalUrl: z.string().url().nullable(),
  apiAvailable: z.boolean(),
  integrationStatus: z.enum(integrationStatuses),
  contractStatus: z.enum(contractStatuses),
  activationDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  commercialPriority: z.number().int(),
  humanOwnerId: z.uuid().nullable(),
  riskStatus: z.enum(supplierRiskStatuses),
  notes: z.string().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict();
export type Supplier = z.infer<typeof supplierSchema>;

export class SupplierAuthorityError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE') {
    super(message);
    this.name = 'SupplierAuthorityError';
  }
}
