import { startAgentTelemetry } from './telemetry/otel';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { parseApiEnv } from '@precast/shared';
import { getMastraStore } from './lib/storage';
import { agentAuthMiddleware, assertAgentApiAuthConfigured } from './middleware/auth';
import { a2uiMiddleware } from './middleware/a2ui';
import { telemetryMiddleware } from './middleware/telemetry';
import { crew, crewAgents } from './crew';
import { isAgentBaseLlmConfigured } from './lib/agentbase-model';

// R2 — telemetry first. The production container has already started it from
// the preload (`node --import ./telemetry.mjs`), which makes this a no-op there;
// under `mastra dev` this is where it starts. A call, not a bare
// `import './telemetry/otel'`: Mastra's bundler tree-shakes modules as side-effect
// free and dropped that import. See telemetry/otel.ts.
startAgentTelemetry();

// Validate env at boot — fail fast on missing/invalid config. The single root
// `.env` is loaded by the dev/start scripts (dotenv-cli); in production the real
// environment (Docker/host) supplies the vars.
const env = parseApiEnv();

// A production deploy with no AGENT_API_TOKEN serves every agent to anyone who
// can reach the port, and looks perfectly healthy doing it. Fail here rather
// than warn — a warning in a deploy log is not a control.
assertAgentApiAuthConfigured();

// Warn LOUDLY at boot, not just at call time: a missing model should be seen
// the moment `mastra dev`/`mastra start` runs, not mid-conversation. Advisory
// only: an AgentBase-hosted deploy legitimately boots without one on its first
// deploy (the org admin sets the model in Studio after import).
if (!isAgentBaseLlmConfigured() && env.AGENTBASE_HOSTED !== '1') {
  console.warn(
    '⚠️  No model configured — agents will boot, but any chat or tool call will fail. ' +
      'Set AGENTBASE_LLM_MODEL and the Application credentials (AGENTBASE_URL, ' +
      'AGENTBASE_TOKEN_URL, AGENTBASE_CLIENT_ID, AGENTBASE_CLIENT_SECRET) in .env, ' +
      'or run pnpm bootstrap --llm-provider=agentbase.',
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
  storage: getMastraStore(),
  logger: new PinoLogger({
    name: 'precast-agents',
    level: LOG_LEVEL_MAP[env.LOG_LEVEL],
  }),
  server: {
    host: env.MASTRA_HOST,
    port: env.MASTRA_PORT,
    // One telemetry log record per A2A call (first, so a refused call is counted
    // too), then static bearer token auth for agent API routes (off when
    // AGENT_API_TOKEN is unset), then A2UI cards. Order matters: auth opens the
    // per-request store that `show_card` writes to and the A2UI middleware reads.
    middleware: [telemetryMiddleware, agentAuthMiddleware, a2uiMiddleware],
  },
});
