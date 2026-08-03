import { z } from 'zod';

export const assuranceLevels = ['aal1', 'aal2'] as const;
export type AssuranceLevel = (typeof assuranceLevels)[number];

const verifiedClaimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  aal: z.enum(assuranceLevels).optional(),
  iat: z.number().int().nonnegative(),
  email: z.email().optional()
});

export type VerifiedViewerClaims = {
  subject: string;
  sessionId: string;
  assuranceLevel: AssuranceLevel;
  issuedAt: number;
  email?: string;
};

export function parseVerifiedViewerClaims(input: unknown): VerifiedViewerClaims | null {
  const parsed = verifiedClaimsSchema.safeParse(input);
  if (!parsed.success) return null;

  return {
    subject: parsed.data.sub,
    sessionId: parsed.data.session_id,
    assuranceLevel: parsed.data.aal ?? 'aal1',
    issuedAt: parsed.data.iat,
    email: parsed.data.email
  };
}
