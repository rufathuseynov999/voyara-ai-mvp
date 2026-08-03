import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { SupplierStore } from './supplier-store';
import {
  ContractAuthorityError,
  contractHashInput,
  supplierContractSchema,
  verifyContractIsActiveAuthority,
  type SupplierContract
} from './contract-authority';

/**
 * Phase 4E — contract authority service. Mirrors the exact discipline
 * already proven for message_send_policies (Phase 4C): draft → human
 * approval with a recomputed content hash → ACTIVE, with every change to
 * the contract's defining terms appending a new immutable version row
 * rather than silently mutating history.
 */

export type ContractServiceContext = {
  store: SupplierStore;
  correlationId: string;
  now: () => Date;
};

export type DraftContractInput = Omit<SupplierContract, 'contractId' | 'status' | 'approvedBy' | 'approvedAt' | 'contentHash' | 'version' | 'createdAt' | 'updatedAt' | 'correlationId'>;

export async function draftContract(ctx: ContractServiceContext, input: DraftContractInput): Promise<{ contractId: string }> {
  const existing = await ctx.store.findContractByReference(input.contractReference);
  if (existing) throw new ContractAuthorityError(`Contract reference "${input.contractReference}" already exists.`, 'DUPLICATE_REFERENCE');

  const contractId = randomUUID();
  const now = ctx.now().toISOString();
  const contract: SupplierContract = {
    ...input, contractId, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null,
    version: 1, correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  const parsed = supplierContractSchema.safeParse(contract);
  if (!parsed.success) throw new ContractAuthorityError('Invalid contract draft.', 'VALIDATION');

  await ctx.store.saveContract(contract);
  return { contractId };
}

/** Human (AAL2, enforced by the caller) approves a contract by content hash
 *  and moves it to ACTIVE. Also appends the first immutable version row. */
export async function approveAndActivateContract(ctx: ContractServiceContext, contractId: string, approvedBy: string): Promise<void> {
  const contract = await ctx.store.loadContract(contractId);
  if (!contract) throw new ContractAuthorityError('Contract not found.', 'NOT_FOUND');

  const contentHash = sha256(contractHashInput(contract));
  const now = ctx.now().toISOString();
  const activated: SupplierContract = { ...contract, status: 'ACTIVE', approvedBy, approvedAt: now, contentHash, updatedAt: now };
  const parsed = supplierContractSchema.safeParse(activated);
  if (!parsed.success) throw new ContractAuthorityError('Contract failed validation on activation.', 'VALIDATION');

  await ctx.store.saveContract(activated);
  await ctx.store.saveContractVersion({
    versionRecordId: randomUUID(), contractId, version: activated.version, contentHash,
    snapshot: contractHashInput(activated), createdBy: approvedBy, correlationId: ctx.correlationId
  });
}

/** Any change to a contract's defining terms appends a NEW version and
 *  requires re-approval before it can authorize anything again — it never
 *  mutates the currently-active version in place. The contract reverts to
 *  DRAFT (not ACTIVE) until a human re-approves the new version. */
export async function reviseContract(
  ctx: ContractServiceContext,
  contractId: string,
  revisedFields: Partial<Pick<SupplierContract, 'pricingStructure' | 'markupRules' | 'expiryDate' | 'currency' | 'refundResponsibility' | 'chargebackResponsibility' | 'productsCovered'>>,
  revisedBy: string
): Promise<{ newVersion: number }> {
  const contract = await ctx.store.loadContract(contractId);
  if (!contract) throw new ContractAuthorityError('Contract not found.', 'NOT_FOUND');

  const newVersion = contract.version + 1;
  const now = ctx.now().toISOString();
  const revised: SupplierContract = {
    ...contract, ...revisedFields, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null,
    version: newVersion, updatedAt: now
  };
  await ctx.store.saveContract(revised);
  return { newVersion };
}

/** The single gate every downstream operation (service booking, air
 *  ticketing, portal task) must pass before citing this contract as
 *  authority. Loads the contract fresh and re-verifies — never trusts a
 *  contract object handed in from elsewhere without checking it again. */
export async function requireActiveContractAuthority(ctx: ContractServiceContext, contractId: string): Promise<SupplierContract> {
  const contract = await ctx.store.loadContract(contractId);
  if (!contract) throw new ContractAuthorityError('Contract not found.', 'NOT_FOUND');
  verifyContractIsActiveAuthority(contract, ctx.now());
  return contract;
}
