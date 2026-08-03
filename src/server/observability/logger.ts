/**
 * Phase 3C — structured logging.
 *
 * Deliberately NOT marked 'server-only': this module touches no secrets and
 * no client-unsafe API by itself (callers are responsible for what context
 * they pass in, and that context is redacted defensively below), so it stays
 * importable by the hermetic test suite — matching the precedent set by
 * `orchestration-service.ts` in Phase 3B Part 3.
 *
 * A small, dependency-free leveled JSON logger. Every entry is a single-line
 * JSON object (safe for any log aggregator that ingests stdout/stderr) with a
 * timestamp, level, message, and optional structured context. Output honors
 * `VOYARA_LOG_LEVEL` (debug < info < warn < error); entries below the
 * configured level are dropped before formatting. Common secret-shaped keys
 * in the context object are redacted defensively — this is a safety net, not
 * a substitute for not logging secrets in the first place.
 */

const levels = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof levels)[number];

const REDACTED = '[redacted]';
const secretKeyPattern = /(secret|token|password|authorization|apikey|api_key|jwt|cookie)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = secretKeyPattern.test(key) ? REDACTED : redact(entry, depth + 1);
  }
  return out;
}

function configuredLevel(): LogLevel {
  const raw = process.env.VOYARA_LOG_LEVEL;
  return (levels as readonly string[]).includes(raw ?? '') ? (raw as LogLevel) : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return levels.indexOf(level) >= levels.indexOf(configuredLevel());
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: redact(context) } : {})
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context)
};

/** Exposed for tests only — not part of the public logging surface. */
export const __testing = { redact, shouldLog, configuredLevel };
