import { z } from 'zod';
import { isPostgresUrl } from './database.js';

/** Shared `.refine()` for any var that must be a Postgres connection URL. */
const postgresUrl = (varName: string) =>
  z.string().refine(isPostgresUrl, {
    message:
      `${varName} must be a Postgres URL (postgres:// or postgresql://). ` +
      `Precast is Postgres-only — SQLite and libsql are not supported (see ADR-002).`,
  });

/**
 * Shared environment schema.
 *
 * This is the canonical env validation for projects using this boilerplate.
 * Extend this schema with project-specific variables.
 *
 * Kept a plain `ZodObject` (no top-level `.transform()`) so downstream projects
 * can still call `EnvSchema.extend({...})`. Cross-field defaulting therefore
 * lives in helpers below (see {@link resolveMastraDbUrl}) rather than in the
 * schema itself.
 */
export const EnvSchema = z.object({
  // ── Mastra API (agents + Studio) ───────────────────────────────────────────
  MASTRA_PORT: z.coerce.number().default(45000),
  MASTRA_HOST: z.string().default('0.0.0.0'),
  // Agent memory/thread store (Mastra's own threads, messages, working memory).
  // Postgres, like everything else — see ADR-002.
  //
  // OPTIONAL, and that is deliberate: when unset it falls back to DATABASE_URL
  // (via resolveMastraDbUrl), so a project needs exactly ONE provisioned
  // Postgres to boot. Set it explicitly only when you want agent memory on a
  // separate instance or schema from your application data — a reasonable
  // choice, since the two have very different growth and retention profiles.
  MASTRA_DB_URL: postgresUrl('MASTRA_DB_URL').optional(),
  // Postgres schema that Mastra creates its own tables in. Namespacing them
  // keeps agent-memory tables from colliding with the project's own when
  // MASTRA_DB_URL and DATABASE_URL point at the same database (the default).
  MASTRA_DB_SCHEMA: z.string().default('mastra'),

  // ── Web ──────────────────────────────────────────────────────────────────
  WEB_PORT: z.coerce.number().default(45001),
  WEB_HOST: z.string().default('0.0.0.0'),

  // ── LLM access ─────────────────────────────────────────────────────────────
  // Models come from the AgentBase LLM gateway only, authenticated with the
  // Application credentials below (AGENTBASE_LLM_MODEL + AGENTBASE_URL +
  // AGENTBASE_TOKEN_URL + AGENTBASE_CLIENT_ID/SECRET). No vendor *_API_KEY is
  // read anywhere since v0.10.0; AgentBase holds the provider keys.

  // ── Database ───────────────────────────────────────────────────────────────
  // Postgres, always — see ADR-002. A provisioned Postgres is a precondition of
  // bootstrapping a Precast project, so there is no SQLite path and no
  // local-file fallback to branch on. Required with no default: it fails fast
  // if unset.
  //
  // Precast still does not run Postgres in Compose (CLAUDE.md §4.5) — point
  // this at a managed instance (Neon, Supabase, RDS, Railway, …).
  DATABASE_URL: postgresUrl('DATABASE_URL'),

  // ── Redis (remote / managed) ───────────────────────────────────────────────
  // Point at a managed Redis (Upstash, Redis Cloud, …). The localhost default is
  // a dev fallback only; set your `rediss://` URL in `.env` for real use.
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // ── Keycloak / OIDC (remote) ───────────────────────────────────────────────
  // Point at your hosted Keycloak (or any OIDC issuer). The localhost default is
  // a dev fallback only; set your issuer URL in `.env` for real use.
  KEYCLOAK_TOKEN_ISSUER_URI: z.string().url().default('http://localhost:45002/realms/precast'),
  KEYCLOAK_CLIENT_ID: z.string().default('precast-api'),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),

  // Base URL the web app uses to reach the Mastra agent API for *direct* A2A
  // calls (when AgentBase is disabled). Docker sets this to http://agents:45000.
  MASTRA_INTERNAL_URL: z.string().url().default('http://localhost:45000'),

  // ── AgentBase (A2A registry/proxy) ─────────────────────────────────────────
  // The AgentBase proxy is the only transport: the web app sends every A2A
  // call through it. The one exception is the development switch below.
  // Development switch: '1' makes the web app call the local agents app
  // directly over A2A (before the project is imported into AgentBase); unset
  // or '0' goes through the AgentBase proxy. Never a deployment mode.
  PRECAST_LOCAL_AGENTS: z.enum(['0', '1']).default('0'),
  // Deprecated alias from before v0.10.0: ENABLE_AGENTBASE=0 meant what
  // PRECAST_LOCAL_AGENTS=1 means now. Read for one release, then removed.
  ENABLE_AGENTBASE: z.enum(['0', '1']).optional(),
  // AgentBase auth is a developer "Application" (OAuth2 client_credentials) —
  // NOT a static token. The web app mints its own short-lived JWT from these
  // (see apps/web/app/lib/agentbase-auth.ts); create the Application in
  // AgentBase Studio and copy its clientId/clientSecret/tokenUrl.
  // These are the CANONICAL AgentBase credentials for the whole project: the
  // web app's A2A proxy auth, the agents' LLM gateway, and the agents' MCP
  // proxy all authenticate with this one Application. They carry no capability
  // infix precisely because they are not capability-specific. Per-agent
  // overrides (AGENTBASE_CLIENT_ID_<AGENT_ID>) are read straight from
  // process.env by agentbase-model.ts, like AGENTBASE_AGENT_URL_<AGENT_ID>.
  AGENTBASE_CLIENT_ID: z.string().optional(),
  AGENTBASE_CLIENT_SECRET: z.string().optional(),
  AGENTBASE_TOKEN_URL: z.string().url().optional(),
  // The AgentBase API base (e.g. https://api.agentbase.example.com). Needed for
  // runtime agent discovery (AGENTDISC-1): the web app calls `POST {base}/mcp`
  // to read its own subscriptions, then each agent's card, to learn which slug
  // belongs to which Mastra id. ONE var replaces the per-agent URL vars.
  AGENTBASE_URL: z.string().url().optional(),
  // Per-agent invocation URLs are NOT listed here — one dynamically-named var
  // per Mastra agent (AGENTBASE_AGENT_URL_<AGENT_ID>, read directly from
  // process.env by agentbase-discovery.ts), since the set of agents isn't known
  // at schema-definition time. As of AGENTDISC-1 these are an OVERRIDE, not the
  // source of truth: leave them unset and the URL is discovered. See
  // .env.example.

  // ── AgentBase LLM gateway (org-admin-configured model per imported agent) ──
  // AgentBase injects these into the `apps/agents` container; never present in
  // External mode or plain local dev. See
  // docs/INTEGRATION_AGENTBASE.md §7.9.
  //   AGENTBASE_HOSTED='1'  — always injected on an AgentBase-hosted (imported)
  //     container. When set, an agent with NO model configured fails loudly at
  //     call time rather than falling back to a `.env` provider key: on
  //     AgentBase the model must be set per agent from the org's onboarded
  //     models. When absent (local/External), the agent uses the account-level
  //     AGENTBASE_LLM_MODEL below, and fails at call time with the same kind of
  //     message when that is unset too.
  //   AGENTBASE_LLM_BASE_URL / _TOKEN_URL — shared per container; injected once
  //     any agent has a model set.
  //   AGENTBASE_LLM_CLIENT_ID_<AGENT_ID> / _CLIENT_SECRET_<AGENT_ID> /
  //     _MODEL_<AGENT_ID> — one set per Mastra agent id (mirrors
  //     AGENTBASE_AGENT_URL_<AGENT_ID> above), read directly from process.env by
  //     apps/agents/src/mastra/lib/agentbase-model.ts, not enumerated here.
  //   AGENTBASE_MCP_BASE_URL — the MCP proxy root, injected UNCONDITIONALLY on a
  //     hosted container (unlike the LLM vars, which appear only for a
  //     configured agent). The agent calls `{base}/subscriptions` to discover
  //     which MCP servers it may use, then `{base}/:org/:slug/mcp` to call them,
  //     authenticating with the SAME per-agent Application credentials above —
  //     the MCP proxy and the LLM gateway share one guard. See
  //     apps/agents/src/mastra/lib/agentbase-mcp.ts. An empty subscription list
  //     is a real answer, which is why the var is always present.
  AGENTBASE_HOSTED: z.enum(['0', '1']).optional(),
  AGENTBASE_LLM_BASE_URL: z.string().url().optional(),
  AGENTBASE_LLM_TOKEN_URL: z.string().url().optional(),
  //   AGENTBASE_LLM_MODEL / _MODEL_<AGENT_ID> — "<provider>/<model>". A genuine
  //     LLM setting, so it keeps the infix. ACCOUNT-level when unsuffixed:
  //     supplied by the developer rather than injected, which is what makes
  //     models usable from local dev / External where nothing is injected. The suffixed per-agent var always
  //     wins, so an org admin's Studio choice can never be overridden by a repo
  //     `.env`.
  AGENTBASE_LLM_MODEL: z.string().optional(),
  //   AGENTBASE_LLM_CLIENT_ID / _CLIENT_SECRET / _TOKEN_URL — DEPRECATED names
  //     for the credentials above. Still accepted, and deliberately: AgentBase
  //     INJECTS these into a hosted container and this repo does not control
  //     the injector, so removing them would break every hosted import on its
  //     next redeploy. Write the unprefixed names; expect to read these.
  AGENTBASE_LLM_CLIENT_ID: z.string().optional(),
  AGENTBASE_LLM_CLIENT_SECRET: z.string().optional(),
  AGENTBASE_MCP_BASE_URL: z.string().url().optional(),

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

/**
 * The Postgres URL Mastra's own store (threads, messages, working memory)
 * should use: `MASTRA_DB_URL` when set, otherwise `DATABASE_URL`.
 *
 * Falling back keeps the bootstrap requirement at exactly one provisioned
 * Postgres. Both are validated as Postgres by the schema, so the result is
 * always a Postgres URL — the caller never has to re-check.
 */
export function resolveMastraDbUrl(env: Pick<Env, 'MASTRA_DB_URL' | 'DATABASE_URL'>): string {
  return env.MASTRA_DB_URL ?? env.DATABASE_URL;
}
