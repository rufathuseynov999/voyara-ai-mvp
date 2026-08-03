import { validateServerEnvironment } from '@/config/env-core';

try {
  const environment = validateServerEnvironment();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'valid',
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
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid environment'}\n`);
  process.exitCode = 1;
}
