// R2 — start OpenTelemetry FIRST, before @mastra/core (and the http it pulls in)
// is imported, so trace context propagates across the crew's in-process hops and
// onto egress back to AgentBase. See telemetry/otel.ts.
import './telemetry/otel';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { parseApiEnv } from '@precast/shared';
import { getPrecastStore } from './lib/storage';
import { agentAuthMiddleware } from './middleware/auth';
import { crew, crewAgents } from './crew';
import { isLlmProviderConfigured } from './lib/default-model';
import { isAgentBaseLlmConfigured } from './lib/agentbase-model';

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
// Also silent when the AgentBase gateway is configured with account-level
// credentials (`--llm-provider=agentbase`): that project holds no vendor key
// on purpose, and warning about it would be wrong.
if (!isLlmProviderConfigured() && !isAgentBaseLlmConfigured() && env.AGENTBASE_HOSTED !== '1') {
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
 * `mastra dev` serves this on MASTRA_PORT (default 45000): Mastra's HTTP surface
 * under `/api/*` (A2A + agent routes) and the Studio playground at the root.
 *
 * SCOPE — this app (`apps/agents`) hosts **Mastra agents only** (and the tools
 * they call). Do NOT add MCP servers or hand-rolled REST/HTTP endpoints here:
 * agents reach external MCPs/APIs as *tools* (e.g. via `@mastra/mcp`), and
 * Mastra already exposes each agent over A2A. Web/BFF routes live in `apps/web`.
 *
 * The registered agents come from `crew.ts` — the single source of truth for
 * the roster and its orchestrator front door. `crewAgents(crew)` returns the
 * orchestrator (`crew-orchestrator`, active at 2+ members) plus every member,
 * de-duplicated; each gets its own A2A card at
 * `/api/.well-known/:id/agent-card.json` automatically, so members stay
 * standalone even when fronted by the orchestrator. Add/replace your project's
 * real agents in `crew.ts`, designed from the feed-forward docs (templates/)
 * and TECH_STACK — not from the placeholders.
 *
 * Auth: When `AGENT_API_TOKEN` is set, all agent API routes (`/api/a2a/*`,
 * `/agents/*`) are protected by a static bearer token. AgentBase injects this
 * token when proxying requests. Off when unset (local dev).
 */
export const mastra = new Mastra({
  agents: crewAgents(crew),
  // Durable Postgres store for everything Mastra persists (threads, messages,
  // working memory, workflow state). The same instance is handed to each
  // agent's Memory so the process keeps one connection pool — see lib/storage.ts.
  storage: getPrecastStore(),
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
