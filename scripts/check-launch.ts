import { validateProductionEnvironment } from '@/config/env-core';

try {
  const environment = validateProductionEnvironment();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'launch-environment-valid',
        appOrigin: new URL(environment.appUrl).origin,
        supabaseOrigin: new URL(environment.supabaseUrl).origin,
        databaseHost: new URL(environment.databaseUrl).hostname,
        releaseId: environment.releaseId,
        demoMode: environment.demoMode,
        logLevel: environment.logLevel
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid Production environment'}\n`);
  process.exitCode = 1;
}
