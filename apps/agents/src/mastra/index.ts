import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { parseApiEnv } from '@precast/shared';
import { agentAuthMiddleware } from './middleware/auth';
import { exampleAgent } from './agents/example-agent';
import { summaryAgent } from './agents/summary-agent';
import { isLlmProviderConfigured } from './lib/default-model';

// Validate env at boot — fail fast on missing/invalid config. The single root
// `.env` is loaded by the dev/start scripts (dotenv-cli); in production the real
// environment (Docker/host) supplies the vars.
const env = parseApiEnv();

// Warn LOUDLY at boot, not just at call time (see default-model.ts's
// unconfiguredLocalModel) — a missing LLM key should surface the moment
// `mastra dev`/`mastra start` runs, not get discovered mid-conversation.
// This is advisory only: an AgentBase-hosted deploy legitimately boots
// without one on its first deploy (see agentbase-model.ts), so we don't fail
// the boot here, only make the gap impossible to miss in the terminal.
if (!isLlmProviderConfigured() && env.AGENTBASE_HOSTED !== '1') {
  console.warn(
    '⚠️  No LLM provider configured — agents will boot, but any actual chat/tool-call will fail. ' +
      'Set ONE of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY in .env ' +
      '(or DEFAULT_LLM_MODEL for a specific model).',
  );
}

// The shared schema allows pino's full range; Mastra's logger supports a
// subset, so map the two extremes onto the nearest supported level.
const LOG_LEVEL_MAP = {
  fatal: 'error',
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
  trace: 'debug',
} as const;

/**
 * The Mastra instance is the entry point for all agents, tools, and workflows.
 * `mastra dev` serves this on MASTRA_PORT (default 4111): Mastra's HTTP surface
 * under `/api/*` (A2A + agent routes) and the Studio playground at the root.
 *
 * SCOPE — this app (`apps/agents`) hosts **Mastra agents only** (and the tools
 * they call). Do NOT add MCP servers or hand-rolled REST/HTTP endpoints here:
 * agents reach external MCPs/APIs as *tools* (e.g. via `@mastra/mcp`), and
 * Mastra already exposes each agent over A2A. Web/BFF routes live in `apps/web`.
 *
 * `exampleAgent` and `summaryAgent` are neutral placeholders that prove the
 * wiring is multi-agent: each key in `agents` gets its own A2A card at
 * `/api/.well-known/:id/agent-card.json` automatically. Register your project's
 * real agents here, designed from the feed-forward docs (templates/) and
 * TECH_STACK — not from the placeholders.
 *
 * Auth: When `AGENT_API_TOKEN` is set, all agent API routes (`/api/a2a/*`,
 * `/agents/*`) are protected by a static bearer token. AgentBase injects this
 * token when proxying requests. Off when unset (local dev).
 */
export const mastra = new Mastra({
  agents: { exampleAgent, summaryAgent },
  // Durable store for agent memory/threads. Defaults to a local SQLite file;
  // point MASTRA_DB_URL at libsql/Turso (or swap for @mastra/pg) in production.
  storage: new LibSQLStore({
    id: 'precast-store',
    url: env.MASTRA_DB_URL,
  }),
  logger: new PinoLogger({
    name: 'precast-agents',
    level: LOG_LEVEL_MAP[env.LOG_LEVEL],
  }),
  server: {
    host: env.MASTRA_HOST,
    port: env.MASTRA_PORT,
    // Static bearer token auth for agent API routes.
    // Off when AGENT_API_TOKEN is unset; enforced when present.
    middleware: agentAuthMiddleware,
  },
});
