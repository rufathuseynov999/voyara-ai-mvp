import type { CooDigest } from './coo-agent-contract';

/** Phase 4A — COO digest persistence port. Read-only artifact: there is no
 *  update/delete method on this interface at all, only save + list. */
export interface CooDigestStore {
  saveDigest(digest: CooDigest): Promise<void>;
  listRecentDigests(accountId: string, limit: number): Promise<CooDigest[]>;
}
