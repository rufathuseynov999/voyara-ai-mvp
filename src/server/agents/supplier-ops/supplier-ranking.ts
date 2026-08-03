import type { SupplierStore } from './supplier-store';
import { verifyContractIsActiveAuthority } from './contract-authority';
import type { SupplierType } from './supplier-contract';

/**
 * Phase 4E — supplier ranking. Ranks only suppliers with a genuinely active,
 * approved contract for the requested product/destination — a supplier
 * with no active contract, or whose contract fails the same
 * verifyContractIsActiveAuthority check used everywhere else in this
 * module, is excluded from ranking entirely, not ranked last. Every
 * recommendation carries an explicit explanation: which contracts were
 * considered, which data was unavailable, and whether the NET price shown
 * came from a real, provided source — never fabricated. There is no
 * function anywhere in this file that invents a price or claims
 * availability without a named source.
 */

export type AvailabilitySource = 'API' | 'PORTAL' | 'EMAIL' | 'MANUAL_CONFIRMATION' | 'UNAVAILABLE';

export type RankingCandidate = {
  supplierId: string;
  contractId: string;
  supplierType: SupplierType;
  destination: string;
  netPriceMinorUnits: number | null;
  availabilitySource: AvailabilitySource;
  cancellationFlexibilityScore: number | null;
  historicalReliabilityScore: number | null;
  riskStatus: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNDER_REVIEW';
  customerPreferredSupplierId: string | null;
};

export type RankedSupplier = {
  supplierId: string;
  contractId: string;
  score: number;
  explanation: {
    reasonsSelected: string[];
    dataUnavailable: string[];
    availabilitySource: AvailabilitySource;
    netPriceMinorUnits: number | null;
  };
};

export type RankingContext = { store: SupplierStore; now: () => Date };

export async function rankSuppliers(
  ctx: RankingContext,
  candidates: RankingCandidate[],
  requestedDestination: string,
  customerPreferredSupplierId: string | null
): Promise<{ ranked: RankedSupplier[]; excluded: Array<{ supplierId: string; reason: string }> }> {
  const ranked: RankedSupplier[] = [];
  const excluded: Array<{ supplierId: string; reason: string }> = [];

  for (const candidate of candidates) {
    const contract = await ctx.store.loadContract(candidate.contractId);
    if (!contract) {
      excluded.push({ supplierId: candidate.supplierId, reason: 'Contract not found.' });
      continue;
    }
    try {
      verifyContractIsActiveAuthority(contract, ctx.now());
    } catch (error) {
      excluded.push({ supplierId: candidate.supplierId, reason: error instanceof Error ? error.message : 'Contract is not active authority.' });
      continue;
    }
    if (candidate.destination !== requestedDestination) {
      excluded.push({ supplierId: candidate.supplierId, reason: `Does not serve the requested destination (${requestedDestination}).` });
      continue;
    }

    const reasonsSelected: string[] = [];
    const dataUnavailable: string[] = [];
    let score = 0;

    reasonsSelected.push('Active, approved contract in place.');
    reasonsSelected.push(`Product/destination fit: serves ${candidate.destination}.`);

    if (candidate.netPriceMinorUnits !== null) {
      score += Math.max(0, 100 - candidate.netPriceMinorUnits / 1000);
      reasonsSelected.push(`NET price available from a real source (${candidate.availabilitySource}).`);
    } else {
      dataUnavailable.push('NET price not available from any real source.');
    }

    if (candidate.cancellationFlexibilityScore !== null) {
      score += candidate.cancellationFlexibilityScore * 0.3;
      reasonsSelected.push(`Cancellation flexibility score: ${candidate.cancellationFlexibilityScore}/100.`);
    } else {
      dataUnavailable.push('Cancellation flexibility not on file.');
    }

    if (candidate.historicalReliabilityScore !== null) {
      score += candidate.historicalReliabilityScore * 0.3;
      reasonsSelected.push(`Historical reliability score: ${candidate.historicalReliabilityScore}/100.`);
    } else {
      dataUnavailable.push('No historical reliability data on file.');
    }

    if (candidate.riskStatus === 'HIGH') {
      score -= 50;
      reasonsSelected.push('Risk status HIGH — penalized in ranking, not excluded (still an active contract).');
    } else if (candidate.riskStatus === 'LOW') {
      score += 10;
    }

    if (customerPreferredSupplierId && candidate.supplierId === customerPreferredSupplierId) {
      score += 25;
      reasonsSelected.push('Matches the customer\'s stated preferred supplier.');
    }

    if (candidate.availabilitySource === 'UNAVAILABLE') {
      dataUnavailable.push('Availability could not be confirmed from any real source — this supplier is ranked but availability is NOT claimed.');
    }

    ranked.push({
      supplierId: candidate.supplierId, contractId: candidate.contractId, score,
      explanation: { reasonsSelected, dataUnavailable, availabilitySource: candidate.availabilitySource, netPriceMinorUnits: candidate.netPriceMinorUnits }
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return { ranked, excluded };
}
