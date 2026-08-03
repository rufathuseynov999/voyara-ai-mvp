import 'server-only';
import { validateProductionEnvironment } from '@/config/env';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { logger } from '@/server/observability/logger';

export function livenessHealth() {
  return {
    service: 'voyara-bos',
    status: 'ok',
    version: '0.12.0',
    authority: 'liveness-only'
  } as const;
}

export async function readinessHealth() {
  try {
    validateProductionEnvironment();
  } catch (error) {
    logger.warn('readiness check failed: environment invalid', {
      code: 'READINESS_ENVIRONMENT_INVALID',
      reason: error instanceof Error ? error.message : String(error)
    });
    return {
      service: 'voyara-bos',
      status: 'not_ready',
      version: '0.12.0',
      checks: { environment: 'failed', database: 'not_checked' }
    } as const;
  }

  const admin = createAdminSupabaseClient();
  if (!admin) {
    logger.warn('readiness check failed: admin client unavailable', { code: 'READINESS_ADMIN_CLIENT_MISSING' });
    return {
      service: 'voyara-bos',
      status: 'not_ready',
      version: '0.12.0',
      checks: { environment: 'passed', database: 'failed' }
    } as const;
  }

  const { error } = await admin
    .from('membership_plan_catalogue')
    .select('plan_id', { count: 'exact', head: true })
    .abortSignal(AbortSignal.timeout(3_000));

  if (error) {
    // A failing database probe on the readiness endpoint is operationally
    // significant (it drives load-balancer routing) but is expected during
    // deploys/migrations, so it is reported at warn rather than treated as an
    // unexpected application error.
    logger.warn('readiness check failed: database probe failed', {
      code: 'READINESS_DATABASE_PROBE_FAILED',
      reason: error.message
    });
  }

  return error
    ? {
        service: 'voyara-bos',
        status: 'not_ready',
        version: '0.12.0',
        checks: { environment: 'passed', database: 'failed' }
      } as const
    : {
        service: 'voyara-bos',
        status: 'ready',
        version: '0.12.0',
        checks: { environment: 'passed', database: 'passed' }
      } as const;
}
