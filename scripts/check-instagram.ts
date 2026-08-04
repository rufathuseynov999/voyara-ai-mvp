import { validateInstagramConfiguration, InstagramConfigurationError } from '@/config/env-core';

/**
 * Phase 4H — Instagram deployment validator.
 *
 * Mirrors scripts/check-launch.ts's shape. Exits 0 with a status summary
 * for every legitimate configuration state (both brands NOT_CONFIGURED,
 * only one brand configured, both configured). Exits non-zero for any
 * genuinely malformed, partial, duplicate, or mismatched configuration —
 * never silently treats a broken configuration as "not configured."
 */
try {
  const result = validateInstagramConfiguration();
  process.stdout.write(`${JSON.stringify({ status: result.status }, null, 2)}\n`);
} catch (error) {
  if (error instanceof InstagramConfigurationError) {
    process.stderr.write(`${JSON.stringify({ status: 'INVALID', code: error.code, message: error.message }, null, 2)}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid Instagram configuration'}\n`);
  }
  process.exitCode = 1;
}
