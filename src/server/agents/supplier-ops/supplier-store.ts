import type { Supplier } from './supplier-contract';
import type { SupplierContract } from './contract-authority';

/** Phase 4E — supplier/contract store port. */
export interface SupplierStore {
  saveSupplier(supplier: Supplier): Promise<void>;
  loadSupplier(supplierId: string): Promise<Supplier | null>;
  recordSupplierEvent(event: SupplierEventRecord): Promise<void>;

  saveContract(contract: SupplierContract): Promise<void>;
  loadContract(contractId: string): Promise<SupplierContract | null>;
  findContractByReference(contractReference: string): Promise<SupplierContract | null>;
  saveContractVersion(version: ContractVersionRecord): Promise<void>;
}

export type SupplierEventRecord = {
  eventId: string;
  supplierId: string;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
};

export type ContractVersionRecord = {
  versionRecordId: string;
  contractId: string;
  version: number;
  contentHash: string;
  snapshot: Record<string, unknown>;
  createdBy: string;
  correlationId: string;
};
