import type { Supplier } from './supplier-contract';
import type { SupplierContract } from './contract-authority';
import type { ContractVersionRecord, SupplierEventRecord, SupplierStore } from './supplier-store';

export class InMemorySupplierStore implements SupplierStore {
  private readonly suppliers = new Map<string, Supplier>();
  private readonly supplierEvents: SupplierEventRecord[] = [];
  private readonly contracts = new Map<string, SupplierContract>();
  private readonly contractsByReference = new Map<string, string>();
  private readonly contractVersions: ContractVersionRecord[] = [];

  async saveSupplier(supplier: Supplier): Promise<void> {
    this.suppliers.set(supplier.supplierId, supplier);
  }
  async loadSupplier(supplierId: string): Promise<Supplier | null> {
    return this.suppliers.get(supplierId) ?? null;
  }
  async recordSupplierEvent(event: SupplierEventRecord): Promise<void> {
    this.supplierEvents.push(event);
  }

  async saveContract(contract: SupplierContract): Promise<void> {
    const existingId = this.contractsByReference.get(contract.contractReference);
    if (existingId && existingId !== contract.contractId) {
      throw Object.assign(new Error('DUPLICATE_CONTRACT_REFERENCE'), { code: '23505' });
    }
    this.contracts.set(contract.contractId, contract);
    this.contractsByReference.set(contract.contractReference, contract.contractId);
  }
  async loadContract(contractId: string): Promise<SupplierContract | null> {
    return this.contracts.get(contractId) ?? null;
  }
  async findContractByReference(contractReference: string): Promise<SupplierContract | null> {
    const id = this.contractsByReference.get(contractReference);
    return id ? this.contracts.get(id) ?? null : null;
  }
  async saveContractVersion(version: ContractVersionRecord): Promise<void> {
    this.contractVersions.push(version);
  }

  supplierEventsFor(supplierId: string): SupplierEventRecord[] {
    return this.supplierEvents.filter((e) => e.supplierId === supplierId);
  }
  contractVersionsFor(contractId: string): ContractVersionRecord[] {
    return this.contractVersions.filter((v) => v.contractId === contractId);
  }
}
