import { z } from 'zod';
import { sha256 } from '@/server/bos/canonical-json';

/**
 * Phase 4E — contract authority. Same discipline already proven for
 * message_send_policies (Phase 4C) and payment_link_requests (Phase 4B):
 * a contract can only authorize a real operation (a service booking, an
 * air-ticketing record, a portal task) once it is genuinely ACTIVE, and
 * ACTIVE always requires a real human approver and a matching content hash
 * — checked at the moment of use, not just at approval time, so a contract
 * later suspended or altered without a version bump correctly stops
 * authorizing new operations.
 *
 * Never invents contractual terms: every field here is either something a
 * human explicitly entered, or left null/empty until they do.
 */

export const agreementTypes = ['NET_RATE', 'COMMISSION', 'HYBRID', 'CONSOLIDATOR_FARE', 'GDS_ACCESS', 'FRAMEWORK_AGREEMENT'] as const;
export type AgreementType = (typeof agreementTypes)[number];

export const contractStatusValues = ['DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'] as const;
export type ContractStatusEnum = (typeof contractStatusValues)[number];

export const supplierContractSchema = z.object({
  contractId: z.uuid(),
  agreementType: z.enum(agreementTypes),
  rtravelLegalEntity: z.string().trim().min(1),
  supplierId: z.uuid(),
  supplierLegalEntity: z.string().trim().min(1),
  contractReference: z.string().trim().min(1).max(120),
  effectiveDate: z.string(),
  expiryDate: z.string().nullable(),
  renewalConditions: z.string().nullable(),
  territory: z.string().nullable(),
  productsCovered: z.array(z.string()),
  pricingStructure: z.string().min(1),
  markupRules: z.record(z.string(), z.unknown()),
  minimumAdvertisedPriceRestriction: z.string().nullable(),
  currency: z.string().length(3),
  paymentTerms: z.string().nullable(),
  depositOrCreditLineRequirement: z.string().nullable(),
  cancellationRules: z.string().nullable(),
  refundResponsibility: z.string().min(1),
  chargebackResponsibility: z.string().min(1),
  bookingVoucherRequirements: z.string().nullable(),
  resalePermissions: z.record(z.string(), z.unknown()),
  voyaraBrandingAllowed: z.boolean(),
  rtravelIdentityRequired: z.boolean(),
  confidentialityRestrictions: z.string().nullable(),
  status: z.enum(contractStatusValues),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  contentHash: z.string().nullable(),
  version: z.number().int().positive(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().refine(
  (contract) => contract.status !== 'ACTIVE' || (contract.approvedBy !== null && contract.approvedAt !== null && contract.contentHash !== null),
  { message: 'an ACTIVE contract must carry a human approver, approval timestamp, and content hash' }
);
export type SupplierContract = z.infer<typeof supplierContractSchema>;

export class ContractAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE_REFERENCE' | 'NOT_ACTIVE' | 'STALE_HASH' | 'EXPIRED' | 'SUSPENDED'
  ) {
    super(message);
    this.name = 'ContractAuthorityError';
  }
}

/** Canonical content a contract's approval hash is computed over — every
 *  field that materially defines what the contract actually authorizes.
 *  Changing any of these without a new version/re-approval changes the
 *  hash, exactly like policyHashInput for message-send policies. */
export function contractHashInput(contract: {
  contractReference: string; agreementType: AgreementType; supplierId: string; effectiveDate: string;
  expiryDate: string | null; productsCovered: readonly string[]; pricingStructure: string;
  markupRules: Record<string, unknown>; currency: string; refundResponsibility: string; chargebackResponsibility: string;
  voyaraBrandingAllowed: boolean; rtravelIdentityRequired: boolean; version: number;
}) {
  return {
    contractReference: contract.contractReference, agreementType: contract.agreementType, supplierId: contract.supplierId,
    effectiveDate: contract.effectiveDate, expiryDate: contract.expiryDate, productsCovered: [...contract.productsCovered].sort(),
    pricingStructure: contract.pricingStructure, markupRules: contract.markupRules, currency: contract.currency,
    refundResponsibility: contract.refundResponsibility, chargebackResponsibility: contract.chargebackResponsibility,
    voyaraBrandingAllowed: contract.voyaraBrandingAllowed, rtravelIdentityRequired: contract.rtravelIdentityRequired, version: contract.version
  };
}

/** The single check every operation citing a contract as authority must
 *  pass: genuinely ACTIVE right now, hash matches what was actually
 *  approved, and not past its own expiry date. */
export function verifyContractIsActiveAuthority(contract: SupplierContract, now: Date): void {
  if (contract.status === 'SUSPENDED') throw new ContractAuthorityError(`Contract ${contract.contractReference} is suspended.`, 'SUSPENDED');
  if (contract.status === 'EXPIRED' || contract.status === 'TERMINATED') throw new ContractAuthorityError(`Contract ${contract.contractReference} is ${contract.status.toLowerCase()}.`, 'EXPIRED');
  if (contract.status !== 'ACTIVE') throw new ContractAuthorityError(`Contract ${contract.contractReference} is not active (status: ${contract.status}).`, 'NOT_ACTIVE');
  if (contract.expiryDate && new Date(contract.expiryDate).getTime() < now.getTime()) {
    throw new ContractAuthorityError(`Contract ${contract.contractReference} has passed its expiry date.`, 'EXPIRED');
  }
  const recomputed = sha256(contractHashInput(contract));
  if (recomputed !== contract.contentHash) {
    throw new ContractAuthorityError(`Contract ${contract.contractReference}'s content hash no longer matches what was approved.`, 'STALE_HASH');
  }
}
