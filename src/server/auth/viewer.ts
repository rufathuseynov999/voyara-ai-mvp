import 'server-only';
import { redirect } from 'next/navigation';
import { readDemoRole } from '@/config/env';
import type { Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseVerifiedViewerClaims, type AssuranceLevel } from './claims';
import { appRoles, hasAnyRole, type AppRole } from './roles';

export type Viewer = {
  id: string;
  roles: AppRole[];
  source: 'demo' | 'supabase';
  assuranceLevel: AssuranceLevel;
  sessionId: string;
  issuedAt: number;
  email?: string;
};

function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && appRoles.includes(value as AppRole);
}

export async function getViewer(): Promise<Viewer | null> {
  const demoRole = readDemoRole();
  if (demoRole) {
    return {
      id: '00000000-0000-4000-8000-000000000002',
      roles: [demoRole],
      source: 'demo',
      assuranceLevel: 'aal2',
      sessionId: '00000000-0000-4000-8000-000000000003',
      issuedAt: Math.floor(Date.now() / 1000),
      email: 'founder@voyara.example'
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsError ? null : parseVerifiedViewerClaims(claimsData?.claims);
  if (!claims) return null;

  const [roleResult, revocationResult, securityResult] = await Promise.all([
    supabase.from('role_assignments').select('role').eq('user_id', claims.subject).eq('active', true),
    supabase
      .from('session_revocations')
      .select('session_id')
      .eq('user_id', claims.subject)
      .eq('session_id', claims.sessionId)
      .maybeSingle(),
    supabase
      .from('user_session_security')
      .select('revoked_before')
      .eq('user_id', claims.subject)
      .maybeSingle()
  ]);

  if (roleResult.error || revocationResult.error || securityResult.error) return null;
  if (revocationResult.data) return null;

  const revokedBefore = securityResult.data?.revoked_before;
  if (typeof revokedBefore === 'string' && claims.issuedAt * 1000 <= new Date(revokedBefore).getTime()) return null;

  const roles = (roleResult.data ?? []).map(({ role }) => role).filter(isAppRole);

  return {
    id: claims.subject,
    roles,
    source: 'supabase',
    assuranceLevel: claims.assuranceLevel,
    sessionId: claims.sessionId,
    issuedAt: claims.issuedAt,
    email: claims.email
  };
}

export async function requireViewerRole(
  locale: Locale,
  requiredRoles: readonly AppRole[],
  requestedPath: string
): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(requestedPath)}`);
  }
  if (!hasAnyRole(viewer.roles, requiredRoles)) {
    redirect(`/${locale}/access-denied`);
  }
  return viewer;
}

export function requireAssuranceLevel(
  locale: Locale,
  viewer: Viewer,
  requiredLevel: AssuranceLevel,
  requestedPath: string
): Viewer {
  if (requiredLevel === 'aal2' && viewer.assuranceLevel !== 'aal2') {
    redirect(`/${locale}/mfa?next=${encodeURIComponent(requestedPath)}`);
  }
  return viewer;
}
