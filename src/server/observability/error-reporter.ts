import { logger } from './logger';

/**
 * Phase 3C — error monitoring hook.
 *
 * `reportError` is the single call site the rest of the server codebase
 * should use when it wants an error surfaced beyond its immediate catch
 * block. It always writes a structured log entry (so every error is captured
 * by whatever log aggregator reads stdout/stderr — no external account
 * needed). If `VOYARA_ERROR_MONITOR_WEBHOOK` is set, it additionally makes a
 * best-effort POST of a redacted summary to that URL.
 *
 * This is deliberately provider-agnostic: no monitoring SDK (Sentry or
 * otherwise) is bundled, because wiring a real provider requires an account
 * and DSN only the founder can create. Pointing this hook at a provider's
 * ingestion webhook (most support a generic HTTPS webhook or an adapter in
 * front of one) activates real monitoring without further code changes; see
 * docs/phase-3c/VOYARA-PHASE-3C-AUTH-DEPLOYMENT-RUNBOOK.md.
 *
 * The webhook call never throws and never blocks the caller meaningfully
 * (fire-and-forget with a short timeout) — a monitoring outage must never
 * become an application outage.
 */

export type ErrorContext = Record<string, unknown> & {
  /** A short machine-stable code for grouping, e.g. 'ORCHESTRATION_COMMAND_FAILED'. */
  code?: string;
};

export function reportError(error: unknown, context: ErrorContext = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(message, { ...context, stack });

  const webhook = process.env.VOYARA_ERROR_MONITOR_WEBHOOK;
  if (!webhook) return;

  const payload = JSON.stringify({
    message,
    code: context.code ?? null,
    release: process.env.VOYARA_RELEASE_ID ?? null,
    environment: process.env.VERCEL_ENV ?? 'local',
    timestamp: new Date().toISOString()
  });

  try {
    void fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(2_000)
    }).catch(() => {
      // Best-effort only. A monitoring-webhook failure must never surface to
      // the caller or affect the request it was reporting on.
    });
  } catch {
    // Synchronous throw from fetch() construction (e.g. invalid URL) is
    // swallowed for the same reason.
  }
}
