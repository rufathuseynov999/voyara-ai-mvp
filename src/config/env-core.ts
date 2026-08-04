import { z } from 'zod';
import { appRoles, type AppRole } from '@/server/auth/roles';
import { integrationModes, type IntegrationMode } from '@/server/supplier/contract';

/**
 * Phase 3A — supplier & payment integration configuration.
 *
 * Safe by construction: the mode defaults to SIMULATION, live booking defaults
 * to disabled, and any invalid combination throws (fail closed) rather than
 * silently downgrading. Adapter identifiers are opaque, non-secret tokens; the
 * webhook secret is server-only and is never echoed back by any reader.
 */
const adapterIdSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/);
const webhookSecretSchema = z.string().min(32).max(256);

const integrationConfigSchema = z.object({
  supplierMode: z.enum(integrationModes),
  supplierAdapter: adapterIdSchema,
  paymentMode: z.enum(integrationModes),
  paymentAdapter: adapterIdSchema,
  liveBookingEnabled: z.boolean(),
  webhookSecret: webhookSecretSchema.nullable()
}).strict().superRefine((config, ctx) => {
  // Live booking may only be enabled when BOTH supplier and payment are LIVE.
  if (config.liveBookingEnabled && (config.supplierMode !== 'LIVE' || config.paymentMode !== 'LIVE')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Live booking requires both supplier and payment modes to be LIVE.'
    });
  }
  // Any LIVE mode requires a webhook secret to be present.
  if ((config.supplierMode === 'LIVE' || config.paymentMode === 'LIVE') && !config.webhookSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A webhook secret is required when any integration mode is LIVE.'
    });
  }
});

export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

const publicSupabaseSchema = z.object({
  url: z.string().url(),
  publishableKey: z.string().min(20).startsWith('sb_publishable_')
});

const serverSupabaseAdminSchema = z.object({
  url: z.string().url(),
  secretKey: z.string().min(20).startsWith('sb_secret_')
});

const serverEnvironmentSchema = z.object({
  appUrl: z.string().url(),
  supabaseUrl: z.string().url(),
  supabasePublishableKey: z.string().min(20).startsWith('sb_publishable_'),
  supabaseSecretKey: z.string().min(20).startsWith('sb_secret_'),
  databaseUrl: z.string().startsWith('postgresql://'),
  demoMode: z.boolean(),
  demoRole: z.enum(appRoles),
  logLevel: z.enum(['debug', 'info', 'warn', 'error'])
});

const productionControlSchema = z.object({
  healthToken: z.string().min(32).max(256),
  releaseId: z.string().min(7).max(80).regex(/^[A-Za-z0-9._-]+$/)
});

export type PublicSupabaseConfig = z.infer<typeof publicSupabaseSchema>;
export type ServerSupabaseAdminConfig = z.infer<typeof serverSupabaseAdminSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export type ProductionEnvironment = ServerEnvironment & z.infer<typeof productionControlSchema>;

function isReservedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0.0.0.0'
    || normalized.startsWith('127.')
    || normalized === 'example.com'
    || normalized.endsWith('.example.com')
    || normalized.endsWith('.example')
    || normalized.endsWith('.invalid')
    || normalized.endsWith('.test');
}

function containsPlaceholder(value: string): boolean {
  return /(replace[_-]?me|replace[_-]?with|change[_-]?me|placeholder|dummy|example|0123456789)/i.test(value);
}

export function readPublicSupabaseConfig(environment: NodeJS.ProcessEnv = process.env): PublicSupabaseConfig | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url && !publishableKey) return null;
  return publicSupabaseSchema.parse({ url, publishableKey });
}

export function readServerSupabaseAdminConfig(
  environment: NodeJS.ProcessEnv = process.env
): ServerSupabaseAdminConfig | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;

  if (!url && !secretKey) return null;
  return serverSupabaseAdminSchema.parse({ url, secretKey });
}

/**
 * Phase 3C Part 2 — Hotelbeds sandbox credentials (controlled single-supplier
 * activation). Absence is not an error: the supplier registry treats a
 * missing credential set as "this supplier cannot be constructed" and fails
 * closed, never falling back to simulation for a caller that asked for
 * SANDBOX/LIVE. Presence with a placeholder-shaped value IS an error — it
 * would otherwise look like a configured supplier that quietly fails on its
 * first real call instead of failing at startup.
 */
const hotelbedsCredentialsSchema = z.object({
  apiKey: z.string().trim().min(8).max(128),
  apiSecret: z.string().trim().min(8).max(256),
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
    message: 'Hotelbeds base URL must be HTTPS'
  })
});
export type HotelbedsCredentials = z.infer<typeof hotelbedsCredentialsSchema>;

const HOTELBEDS_SANDBOX_BASE_URL = 'https://api.test.hotelbeds.com';

export function readHotelbedsCredentials(
  environment: NodeJS.ProcessEnv = process.env
): HotelbedsCredentials | null {
  const apiKey = environment.VOYARA_HOTELBEDS_API_KEY;
  const apiSecret = environment.VOYARA_HOTELBEDS_API_SECRET;
  if (!apiKey && !apiSecret) return null;

  const baseUrl = environment.VOYARA_HOTELBEDS_BASE_URL ?? HOTELBEDS_SANDBOX_BASE_URL;
  const parsed = hotelbedsCredentialsSchema.parse({ apiKey, apiSecret, baseUrl });
  if (containsPlaceholder(parsed.apiKey) || containsPlaceholder(parsed.apiSecret)) {
    throw new Error('Hotelbeds credentials cannot contain placeholder text.');
  }
  return parsed;
}

/**
 * Phase 3C Part 3 — generic hosted-checkout payment provider credentials.
 *
 * Deliberately provider-neutral: no specific payment provider has been
 * approved by the founder (checked explicitly — see the Part 3 checkpoint),
 * so this reads a generic credential shape (a merchant/API key, a webhook
 * signing secret, and a base URL) rather than any named vendor's field
 * layout. `providerName` is a free-text human label with NO behavioral
 * effect — it exists only so operators can see which real provider a given
 * deployment is configured for; the adapter code itself never branches on it.
 */
const hostedPaymentCredentialsSchema = z.object({
  providerName: z.string().trim().min(2).max(64),
  merchantId: z.string().trim().min(2).max(128),
  apiKey: z.string().trim().min(8).max(256),
  webhookSigningSecret: z.string().trim().min(32).max(256),
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
    message: 'Hosted payment base URL must be HTTPS'
  })
});
export type HostedPaymentCredentials = z.infer<typeof hostedPaymentCredentialsSchema>;

export function readHostedPaymentCredentials(
  environment: NodeJS.ProcessEnv = process.env
): HostedPaymentCredentials | null {
  const providerName = environment.VOYARA_PAYMENT_PROVIDER_NAME;
  const merchantId = environment.VOYARA_PAYMENT_MERCHANT_ID;
  const apiKey = environment.VOYARA_PAYMENT_API_KEY;
  const webhookSigningSecret = environment.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET;
  if (!providerName && !merchantId && !apiKey && !webhookSigningSecret) return null;

  const baseUrl = environment.VOYARA_PAYMENT_BASE_URL;
  const parsed = hostedPaymentCredentialsSchema.parse({ providerName, merchantId, apiKey, webhookSigningSecret, baseUrl });
  if (
    containsPlaceholder(parsed.providerName)
    || containsPlaceholder(parsed.merchantId)
    || containsPlaceholder(parsed.apiKey)
    || containsPlaceholder(parsed.webhookSigningSecret)
  ) {
    throw new Error('Hosted payment credentials cannot contain placeholder text.');
  }
  return parsed;
}

export function readDemoRole(environment: NodeJS.ProcessEnv = process.env): AppRole | null {
  if (environment.VOYARA_DEMO_MODE !== 'true') return null;
  if (environment.NODE_ENV === 'production') {
    throw new Error('VOYARA_DEMO_MODE cannot be enabled in Production.');
  }

  const role = environment.VOYARA_DEMO_ROLE ?? 'founder';
  return z.enum(appRoles).parse(role);
}

export function validateServerEnvironment(environment: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  const parsed = serverEnvironmentSchema.parse({
    appUrl: environment.NEXT_PUBLIC_APP_URL,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: environment.SUPABASE_SECRET_KEY,
    databaseUrl: environment.DATABASE_URL,
    demoMode: environment.VOYARA_DEMO_MODE === 'true',
    demoRole: environment.VOYARA_DEMO_ROLE ?? 'founder',
    logLevel: environment.VOYARA_LOG_LEVEL ?? 'info'
  });

  if (environment.NODE_ENV === 'production' && parsed.demoMode) {
    throw new Error('VOYARA_DEMO_MODE cannot be enabled in Production.');
  }

  const exposedNames = Object.keys(environment).filter(
    (name) => name.startsWith('NEXT_PUBLIC_') && /(SECRET|SERVICE_ROLE|DATABASE_URL)/i.test(name)
  );
  if (exposedNames.length > 0) {
    throw new Error(`Server-only variables use a public prefix: ${exposedNames.join(', ')}`);
  }

  return parsed;
}

/**
 * Read the supplier/payment integration configuration.
 *
 * Safe defaults: mode SIMULATION, adapter 'simulation', live booking disabled.
 * The boolean flag is strict — only the exact string 'true' enables it, and any
 * other value (including typos) resolves to disabled. Invalid modes/adapters or
 * an inconsistent LIVE combination throw (fail closed). The webhook secret is
 * read but never returned to callers that log it; callers should treat the
 * returned `webhookSecret` as sensitive.
 */
export function readIntegrationConfig(environment: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  const mode = (value: string | undefined): IntegrationMode => {
    const parsed = z.enum(integrationModes).safeParse(value ?? 'SIMULATION');
    if (!parsed.success) {
      throw new Error(`Invalid integration mode: ${String(value)}`);
    }
    return parsed.data;
  };

  return integrationConfigSchema.parse({
    supplierMode: mode(environment.VOYARA_SUPPLIER_MODE),
    supplierAdapter: environment.VOYARA_SUPPLIER_ADAPTER ?? 'simulation',
    paymentMode: mode(environment.VOYARA_PAYMENT_MODE),
    paymentAdapter: environment.VOYARA_PAYMENT_ADAPTER ?? 'simulation',
    liveBookingEnabled: environment.VOYARA_LIVE_BOOKING_ENABLED === 'true',
    webhookSecret: environment.VOYARA_WEBHOOK_SECRET ?? null
  });
}

/**
 * Phase 3C — deployment environment classification.
 *
 * Three environments are supported end to end: local (developer machine,
 * demo mode permitted), preview (Vercel preview deployments against a
 * staging Supabase project — real auth, real RLS, never demo mode), and
 * production (the apex domain, strictest validation). Vercel sets
 * `VERCEL_ENV` automatically to 'production' | 'preview' | 'development' on
 * every deployment; a missing `VERCEL_ENV` (any non-Vercel host, including a
 * developer's own machine) is treated as local.
 */
export const deploymentEnvironments = ['local', 'preview', 'production'] as const;
export type DeploymentEnvironment = (typeof deploymentEnvironments)[number];

export function readDeploymentEnvironment(environment: NodeJS.ProcessEnv = process.env): DeploymentEnvironment {
  const vercelEnv = environment.VERCEL_ENV;
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  return 'local';
}

/**
 * Preview validation shares production's strictness for everything that
 * protects real user data (HTTPS, no demo mode, no placeholder secrets,
 * TLS-enforced database) but does not require the release identifier or a
 * dedicated health-monitoring token, since preview deployments are ephemeral
 * and not paged on. Preview is expected to point at a separate (staging)
 * Supabase project — that is an operational choice made in Vercel's
 * environment-variable dashboard, not something this function can verify.
 */
export function validatePreviewEnvironment(environment: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  const server = validateServerEnvironment(environment);

  if (readDeploymentEnvironment(environment) !== 'preview') {
    throw new Error('VERCEL_ENV must be "preview" for preview validation.');
  }
  if (server.demoMode) {
    throw new Error('Demo mode is forbidden in Preview.');
  }

  const appUrl = new URL(server.appUrl);
  const supabaseUrl = new URL(server.supabaseUrl);
  const databaseUrl = new URL(server.databaseUrl);
  if (appUrl.protocol !== 'https:' || isReservedHostname(appUrl.hostname)) {
    throw new Error('Preview application URL must be a non-reserved HTTPS origin.');
  }
  if (supabaseUrl.protocol !== 'https:' || isReservedHostname(supabaseUrl.hostname)) {
    throw new Error('Preview Supabase URL must be a non-reserved HTTPS origin.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || isReservedHostname(databaseUrl.hostname)) {
    throw new Error('Preview database URL must target a non-reserved PostgreSQL host.');
  }
  if (!['require', 'verify-ca', 'verify-full'].includes(databaseUrl.searchParams.get('sslmode') ?? '')) {
    throw new Error('Preview database URL must enforce TLS with sslmode.');
  }
  if (containsPlaceholder(server.supabasePublishableKey) || containsPlaceholder(server.supabaseSecretKey)) {
    throw new Error('Preview credentials cannot contain placeholders.');
  }

  return server;
}

/**
 * Dispatches to the correct validator for the detected deployment
 * environment. Local performs the base (non-strict) server validation only;
 * preview and production apply their respective strict checks.
 */
export function validateDeploymentEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): { environment: DeploymentEnvironment; config: ServerEnvironment } {
  const deployment = readDeploymentEnvironment(environment);
  if (deployment === 'production') {
    return { environment: deployment, config: validateProductionEnvironment(environment) };
  }
  if (deployment === 'preview') {
    return { environment: deployment, config: validatePreviewEnvironment(environment) };
  }
  return { environment: deployment, config: validateServerEnvironment(environment) };
}

export function readHealthToken(environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment.VOYARA_HEALTH_TOKEN;
  if (!value) return null;
  return productionControlSchema.shape.healthToken.parse(value);
}

export function validateProductionEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): ProductionEnvironment {
  const server = validateServerEnvironment(environment);
  const controls = productionControlSchema.parse({
    healthToken: environment.VOYARA_HEALTH_TOKEN,
    releaseId: environment.VOYARA_RELEASE_ID
  });

  if (environment.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be production for launch validation.');
  }
  if (server.demoMode) {
    throw new Error('Demo mode is forbidden for launch validation.');
  }
  if (server.logLevel === 'debug') {
    throw new Error('Debug logging is forbidden for launch validation.');
  }

  const appUrl = new URL(server.appUrl);
  const supabaseUrl = new URL(server.supabaseUrl);
  const databaseUrl = new URL(server.databaseUrl);
  if (appUrl.protocol !== 'https:' || isReservedHostname(appUrl.hostname)) {
    throw new Error('Production application URL must be a non-reserved HTTPS origin.');
  }
  if (appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
    throw new Error('Production application URL must contain only its HTTPS origin.');
  }
  if (supabaseUrl.protocol !== 'https:' || isReservedHostname(supabaseUrl.hostname)) {
    throw new Error('Production Supabase URL must be a non-reserved HTTPS origin.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || isReservedHostname(databaseUrl.hostname)) {
    throw new Error('Production database URL must target a non-reserved PostgreSQL host.');
  }
  if (!['require', 'verify-ca', 'verify-full'].includes(databaseUrl.searchParams.get('sslmode') ?? '')) {
    throw new Error('Production database URL must enforce TLS with sslmode.');
  }
  if (
    containsPlaceholder(server.supabasePublishableKey)
    || containsPlaceholder(server.supabaseSecretKey)
    || containsPlaceholder(controls.healthToken)
    || containsPlaceholder(controls.releaseId)
  ) {
    throw new Error('Production credentials and release controls cannot contain placeholders.');
  }
  if (controls.healthToken === server.supabaseSecretKey || controls.healthToken === server.supabasePublishableKey) {
    throw new Error('Health monitoring must use a dedicated secret token.');
  }

  return { ...server, ...controls };
}

/**
 * Phase 4C — WhatsApp Cloud API credentials, multi-account-ready (R-Travel
 * and VOYARA numbers, or a single Meta test number for initial
 * certification). No live Meta credentials exist anywhere in this project —
 * absence is expected, not an error; the channel registry fails closed for
 * this exact reason. Presence with a placeholder value IS an error.
 */
const whatsappCredentialsSchema = z.object({
  phoneNumberId: z.string().trim().min(4).max(64),
  wabaId: z.string().trim().min(4).max(64),
  accessToken: z.string().trim().min(16).max(2048),
  appSecret: z.string().trim().min(16).max(256),
  webhookVerifyToken: z.string().trim().min(16).max(256),
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
    message: 'WhatsApp Cloud API base URL must be HTTPS'
  })
});
export type WhatsAppCredentials = z.infer<typeof whatsappCredentialsSchema>;

const WHATSAPP_DEFAULT_BASE_URL = 'https://graph.facebook.com/v20.0';

export function readWhatsAppCredentials(
  environment: NodeJS.ProcessEnv = process.env
): WhatsAppCredentials | null {
  const phoneNumberId = environment.VOYARA_WHATSAPP_PHONE_NUMBER_ID;
  const wabaId = environment.VOYARA_WHATSAPP_WABA_ID;
  const accessToken = environment.VOYARA_WHATSAPP_ACCESS_TOKEN;
  const appSecret = environment.VOYARA_WHATSAPP_APP_SECRET;
  const webhookVerifyToken = environment.VOYARA_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!phoneNumberId && !wabaId && !accessToken && !appSecret && !webhookVerifyToken) return null;

  const baseUrl = environment.VOYARA_WHATSAPP_BASE_URL ?? WHATSAPP_DEFAULT_BASE_URL;
  const parsed = whatsappCredentialsSchema.parse({ phoneNumberId, wabaId, accessToken, appSecret, webhookVerifyToken, baseUrl });
  if (
    containsPlaceholder(parsed.phoneNumberId) || containsPlaceholder(parsed.wabaId)
    || containsPlaceholder(parsed.accessToken) || containsPlaceholder(parsed.appSecret)
    || containsPlaceholder(parsed.webhookVerifyToken)
  ) {
    throw new Error('WhatsApp credentials cannot contain placeholder text.');
  }
  return parsed;
}

/**
 * Phase 4D — voice/telephony credentials, multi-number/brand-ready. No live
 * telephony credentials exist anywhere in this project — absence is
 * expected, not an error; the voice registry fails closed for this exact
 * reason.
 */
const voiceCredentialsSchema = z.object({
  providerAccountId: z.string().trim().min(4).max(128),
  apiKey: z.string().trim().min(16).max(2048),
  webhookSecret: z.string().trim().min(16).max(256),
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
    message: 'Voice provider base URL must be HTTPS'
  })
});
export type VoiceCredentials = z.infer<typeof voiceCredentialsSchema>;

export function readVoiceCredentials(
  environment: NodeJS.ProcessEnv = process.env
): VoiceCredentials | null {
  const providerAccountId = environment.VOYARA_VOICE_PROVIDER_ACCOUNT_ID;
  const apiKey = environment.VOYARA_VOICE_API_KEY;
  const webhookSecret = environment.VOYARA_VOICE_WEBHOOK_SECRET;
  if (!providerAccountId && !apiKey && !webhookSecret) return null;

  const baseUrl = environment.VOYARA_VOICE_BASE_URL;
  const parsed = voiceCredentialsSchema.parse({ providerAccountId, apiKey, webhookSecret, baseUrl });
  if (containsPlaceholder(parsed.providerAccountId) || containsPlaceholder(parsed.apiKey) || containsPlaceholder(parsed.webhookSecret)) {
    throw new Error('Voice provider credentials cannot contain placeholder text.');
  }
  return parsed;
}

/**
 * Phase 4H — Instagram Messaging credentials, dual-brand (R-Travel +
 * VOYARA). No live Meta credentials exist anywhere in this project —
 * absence is expected, not an error; the channel registry fails closed for
 * this exact reason, identical to WhatsApp and Voice above.
 *
 * Shape mirrors the fact that one Meta App can own two Pages/IG accounts:
 * `appId`/`appSecret`/`webhookVerifyToken` are shared (one Meta App, one
 * webhook subscription for both brands); `instagramAccountId`/`pageId`/
 * `accessToken` are per-brand. A caller can never override which brand a
 * set of stored account config belongs to — `readInstagramCredentials`
 * takes the brand as its OWN parameter and looks up ONLY that brand's env
 * vars; there is no code path where a caller-supplied brand string
 * substitutes for, or is written into, the stored account identity itself.
 */
const instagramAppCredentialsSchema = z.object({
  appId: z.string().trim().min(4).max(64),
  appSecret: z.string().trim().min(16).max(256),
  webhookVerifyToken: z.string().trim().min(16).max(256),
  graphApiVersion: z.string().trim().regex(/^v\d+\.\d+$/, 'Graph API version must look like v21.0'),
  callbackUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
    message: 'Instagram callback URL must be HTTPS'
  })
});
export type InstagramAppCredentials = z.infer<typeof instagramAppCredentialsSchema>;

const INSTAGRAM_DEFAULT_GRAPH_API_VERSION = 'v21.0';

const instagramBrandCredentialsSchema = z.object({
  instagramAccountId: z.string().trim().min(4).max(64),
  pageId: z.string().trim().min(4).max(64),
  accessToken: z.string().trim().min(16).max(2048)
});
export type InstagramBrandCredentials = z.infer<typeof instagramBrandCredentialsSchema>;

export type InstagramCredentials = InstagramAppCredentials & InstagramBrandCredentials & {
  brand: 'RTRAVEL' | 'VOYARA';
};

/** Reads the shared Meta App-level credentials only (no brand). Returns
 *  null if none of the four required env vars are set at all; throws if
 *  SOME but not all are set (a genuinely malformed/partial configuration —
 *  never silently treated as "not configured"), and throws if any value
 *  contains placeholder text. */
export function readInstagramAppCredentials(
  environment: NodeJS.ProcessEnv = process.env
): InstagramAppCredentials | null {
  const appId = environment.VOYARA_META_APP_ID;
  const appSecret = environment.VOYARA_META_APP_SECRET;
  const webhookVerifyToken = environment.VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  const callbackUrl = environment.VOYARA_INSTAGRAM_CALLBACK_URL;
  if (!appId && !appSecret && !webhookVerifyToken && !callbackUrl) return null;

  const graphApiVersion = environment.VOYARA_INSTAGRAM_GRAPH_API_VERSION ?? INSTAGRAM_DEFAULT_GRAPH_API_VERSION;
  const parsed = instagramAppCredentialsSchema.parse({ appId, appSecret, webhookVerifyToken, graphApiVersion, callbackUrl });
  if (
    containsPlaceholder(parsed.appId) || containsPlaceholder(parsed.appSecret)
    || containsPlaceholder(parsed.webhookVerifyToken) || containsPlaceholder(parsed.callbackUrl)
  ) {
    throw new Error('Instagram Meta App credentials cannot contain placeholder text.');
  }
  return parsed;
}

/** Reads ONE brand's Instagram account credentials. `brand` is the
 *  caller's own selection of WHICH brand's env vars to read — it is never
 *  written back into, or trusted as an override of, any stored
 *  configuration; the returned `brand` field simply echoes which set of
 *  variables was actually read. Returns null if none of that brand's three
 *  env vars are set; throws on partial or placeholder values. */
export function readInstagramBrandCredentials(
  brand: 'RTRAVEL' | 'VOYARA',
  environment: NodeJS.ProcessEnv = process.env
): (InstagramBrandCredentials & { brand: 'RTRAVEL' | 'VOYARA' }) | null {
  const prefix = brand === 'RTRAVEL' ? 'VOYARA_INSTAGRAM_RTRAVEL' : 'VOYARA_INSTAGRAM_VOYARA';
  const instagramAccountId = environment[`${prefix}_ACCOUNT_ID`];
  const pageId = environment[`${prefix}_PAGE_ID`];
  const accessToken = environment[`${prefix}_ACCESS_TOKEN`];
  if (!instagramAccountId && !pageId && !accessToken) return null;

  const parsed = instagramBrandCredentialsSchema.parse({ instagramAccountId, pageId, accessToken });
  if (containsPlaceholder(parsed.instagramAccountId) || containsPlaceholder(parsed.pageId) || containsPlaceholder(parsed.accessToken)) {
    throw new Error(`Instagram ${brand} credentials cannot contain placeholder text.`);
  }
  return { ...parsed, brand };
}

/** Combines the shared app credentials with ONE brand's account
 *  credentials into what the adapter actually needs. Returns null unless
 *  BOTH the app-level credentials and the requested brand's credentials
 *  are present — a brand can never be considered "configured" on its own
 *  without the shared app secret/webhook token also being present, since
 *  neither signature verification nor the webhook challenge would be
 *  possible without them. */
export function readInstagramCredentials(
  brand: 'RTRAVEL' | 'VOYARA',
  environment: NodeJS.ProcessEnv = process.env
): InstagramCredentials | null {
  const app = readInstagramAppCredentials(environment);
  const brandCredentials = readInstagramBrandCredentials(brand, environment);
  if (!app || !brandCredentials) return null;
  return { ...app, ...brandCredentials };
}

/**
 * Diagnostic status for the Instagram deployment validator
 * (scripts/check-instagram.ts). Distinguishes every case the Phase 4H
 * production validator requirement lists, WITHOUT throwing for the
 * legitimate "not configured" states — only genuinely malformed, partial,
 * duplicate, or mismatched configuration throws.
 */
export type InstagramConfigurationStatus =
  | { status: 'BOTH_NOT_CONFIGURED' }
  | { status: 'ONLY_RTRAVEL_CONFIGURED' }
  | { status: 'ONLY_VOYARA_CONFIGURED' }
  | { status: 'BOTH_CONFIGURED' };

export class InstagramConfigurationError extends Error {
  readonly code:
    | 'MALFORMED_OR_PLACEHOLDER'
    | 'PARTIAL_CONFIGURATION'
    | 'DUPLICATE_ACCOUNT_ID'
    | 'DUPLICATE_PAGE_ID'
    | 'DUPLICATE_ACCESS_TOKEN'
    | 'BRAND_MISMATCH'
    | 'MISSING_WEBHOOK_TOKEN'
    | 'MISSING_APP_SECRET';

  constructor(message: string, code: InstagramConfigurationError['code']) {
    super(message);
    this.name = 'InstagramConfigurationError';
    this.code = code;
  }
}

/** Validates the FULL Instagram configuration (app + both brands) and
 *  returns a structured status. Throws InstagramConfigurationError — never
 *  returns a "degraded but ok" status — for any of: malformed/placeholder
 *  values (surfaced by the two readers above), a brand configured with
 *  only some of its three variables set, the app configured without a
 *  webhook token or app secret, or either brand claiming the SAME
 *  Instagram account id / Page id / access token as the other brand. The
 *  caller (scripts/check-instagram.ts) exits non-zero on any thrown error,
 *  satisfying "malformed or partial configuration must exit non-zero."
 */
export function validateInstagramConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): InstagramConfigurationStatus {
  const app = readInstagramAppCredentials(environment);

  let rtravel: (InstagramBrandCredentials & { brand: 'RTRAVEL' }) | null = null;
  let voyara: (InstagramBrandCredentials & { brand: 'VOYARA' }) | null = null;
  try {
    rtravel = readInstagramBrandCredentials('RTRAVEL', environment) as (InstagramBrandCredentials & { brand: 'RTRAVEL' }) | null;
    voyara = readInstagramBrandCredentials('VOYARA', environment) as (InstagramBrandCredentials & { brand: 'VOYARA' }) | null;
  } catch (error) {
    throw new InstagramConfigurationError(
      error instanceof Error ? error.message : 'Invalid Instagram brand credentials.',
      'MALFORMED_OR_PLACEHOLDER'
    );
  }

  if (!app && !rtravel && !voyara) return { status: 'BOTH_NOT_CONFIGURED' };

  if ((rtravel || voyara) && !app) {
    throw new InstagramConfigurationError(
      'At least one brand has Instagram account variables set, but the shared Meta App credentials ' +
      '(VOYARA_META_APP_ID / VOYARA_META_APP_SECRET / VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN / VOYARA_INSTAGRAM_CALLBACK_URL) are not fully set.',
      'PARTIAL_CONFIGURATION'
    );
  }
  if (app && !app.webhookVerifyToken) {
    throw new InstagramConfigurationError('Instagram webhook verification token is missing.', 'MISSING_WEBHOOK_TOKEN');
  }
  if (app && !app.appSecret) {
    throw new InstagramConfigurationError('Instagram Meta App secret is missing.', 'MISSING_APP_SECRET');
  }

  if (rtravel && voyara) {
    if (rtravel.instagramAccountId === voyara.instagramAccountId) {
      throw new InstagramConfigurationError('R-Travel and VOYARA cannot share the same Instagram account id.', 'DUPLICATE_ACCOUNT_ID');
    }
    if (rtravel.pageId === voyara.pageId) {
      throw new InstagramConfigurationError('R-Travel and VOYARA cannot share the same Facebook Page id.', 'DUPLICATE_PAGE_ID');
    }
    if (rtravel.accessToken === voyara.accessToken) {
      throw new InstagramConfigurationError('R-Travel and VOYARA cannot share the same access token.', 'DUPLICATE_ACCESS_TOKEN');
    }
    if (rtravel.brand !== 'RTRAVEL' || voyara.brand !== 'VOYARA') {
      // Structurally unreachable (each reader hard-codes its own brand),
      // kept as an explicit assertion so a future refactor cannot silently
      // reintroduce a brand-swap bug.
      throw new InstagramConfigurationError('Brand identity mismatch while reading Instagram configuration.', 'BRAND_MISMATCH');
    }
    return { status: 'BOTH_CONFIGURED' };
  }

  if (rtravel) return { status: 'ONLY_RTRAVEL_CONFIGURED' };
  if (voyara) return { status: 'ONLY_VOYARA_CONFIGURED' };
  return { status: 'BOTH_NOT_CONFIGURED' };
}
