import { z } from 'zod';

/**
 * Shared environment schema.
 *
 * This is the canonical env validation for projects using this boilerplate.
 * Extend this schema with project-specific variables.
 */
export const EnvSchema = z.object({
  // ── Mastra API (agents + Studio) ───────────────────────────────────────────
  MASTRA_PORT: z.coerce.number().default(4111),
  MASTRA_HOST: z.string().default('0.0.0.0'),
  // Agent memory/thread store. Local SQLite file by default; use a libsql/Turso
  // URL (libsql://...) or swap for @mastra/pg in production.
  MASTRA_DB_URL: z.string().default('file:./mastra.db'),

  // ── Web ──────────────────────────────────────────────────────────────────
  WEB_PORT: z.coerce.number().default(3000),
  WEB_HOST: z.string().default('0.0.0.0'),

  // ── LLM provider ───────────────────────────────────────────────────────────
  // Mastra's model gateway reads the provider key from the environment. Set the
  // one matching the agent's `provider/model` string (default: google/*).
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Redis ────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // ── Keycloak ─────────────────────────────────────────────────────────────
  KEYCLOAK_TOKEN_ISSUER_URI: z.string().url().default('http://localhost:8080/realms/precast'),
  KEYCLOAK_CLIENT_ID: z.string().default('precast-api'),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),

  // Base URL the web app uses to reach the Mastra agent API for *direct* A2A
  // calls (when AgentBase is disabled). Docker sets this to http://agents:4111.
  MASTRA_INTERNAL_URL: z.string().url().default('http://localhost:4111'),

  // ── AgentBase (A2A registry/proxy) ─────────────────────────────────────────
  // AgentBase is the DEFAULT transport (guard rail): the web app proxies A2A
  // calls through AgentBase unless ENABLE_AGENTBASE=0, in which case it talks to
  // Mastra directly over A2A (see MASTRA_INTERNAL_URL + AGENT_API_TOKEN).
  ENABLE_AGENTBASE: z.enum(['0', '1']).default('1'),
  // Base URL for the AgentBase service (used only when ENABLE_AGENTBASE=1).
  AGENTBASE_URL: z.string().url().default('https://agentbase.example.com'),
  // Bearer token for AgentBase authentication (optional; off when unset).
  AGENTBASE_TOKEN: z.string().optional(),

  // ── Mastra API auth ────────────────────────────────────────────────────────
  // Static bearer token required for all inbound agent API requests (A2A and
  // Mastra-native). All Mastra agents require this token.
  // Off when unset — no auth is applied.
  AGENT_API_TOKEN: z.string().optional(),

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse and validate environment variables.
 *
 * Reads from `process.env` by default, or from an explicit source (e.g. the
 * config object NestJS `ConfigModule.validate` hands in). On failure it prints
 * the offending keys and calls process.exit(1) — this runs at boot, before any
 * structured logger exists, so `console` is the only channel available.
 */
export function parseEnv<T extends z.ZodSchema>(
  schema: T,
  source: Record<string, unknown> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    console.error('❌ Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

/**
 * Parse the default env schema.
 */
export function parseDefaultEnv(): Env {
  return parseEnv(EnvSchema);
}

/**
 * Parse the env for the Mastra API. Alias of {@link parseDefaultEnv} kept as a
 * named entry point so the API's intent reads clearly at its call site.
 */
export function parseApiEnv(): Env {
  return parseEnv(EnvSchema);
}
