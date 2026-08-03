import { validatePreviewEnvironment } from '@/config/env-core';

try {
  const environment = validatePreviewEnvironment();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'preview-environment-valid',
        appOrigin: new URL(environment.appUrl).origin,
        supabaseOrigin: new URL(environment.supabaseUrl).origin,
        demoMode: environment.demoMode,
        logLevel: environment.logLevel
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid Preview environment'}\n`);
  process.exitCode = 1;
}
