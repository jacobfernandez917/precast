import { Agent } from '@mastra/core/agent';
import { exampleTool } from '../tools/example-tool';
import { cardTools, SHOW_CARD_INSTRUCTIONS } from '../tools/show-card';
import { resolveAgentModel } from '../lib/agentbase-model';
import { createAgentMemory } from '../lib/memory';
import { createAgentMcpToolset } from '../lib/agentbase-mcp';

const AGENT_ID = 'example-agent';

// MCP tools AgentBase says this agent is subscribed to, resolved for the caller
// each turn acts for (see lib/agentbase-mcp.ts). The PREFLIGHT is deliberate
// top-level await: on a hosted container a discovery failure or a broken server
// fails the BOOT, loudly, rather than serving an agent missing half its
// capabilities. A server with no connected account yet (401 authorization
// required) is skipped with a warning and checked again on later turns, so
// connecting the account in AgentBase brings its tools in with no restart. Off
// AgentBase this resolves to nothing and costs nothing.
const mcpTools = createAgentMcpToolset(AGENT_ID);
await mcpTools.preflight();

/**
 * Placeholder agent — proves the Mastra wiring (agent + tool + model gateway +
 * durable memory) works out of the box. It carries no domain.
 *
 * Replace it with your project's real agents. Design them from your feed-forward
 * docs (see templates/AGENT_SPEC.md) and the tech stack — not from this example.
 */
export const exampleAgent = new Agent({
  id: AGENT_ID,
  name: 'Example Agent',
  instructions:
    'You are a placeholder assistant used to verify the boilerplate. ' +
    'Answer briefly. Use the example tool when asked to echo text. ' +
    'You remember earlier turns in this conversation, and you keep durable ' +
    'facts about the user (their name, preferences, standing instructions) in ' +
    'working memory — update it when you learn one, rather than relying on ' +
    'recalling it from the transcript later.\n\n' +
    // Cards (A2UI): remove this and `...cardTools` below to answer in text only.
    SHOW_CARD_INSTRUCTIONS,
  // Always the AgentBase gateway: the per-agent model an org admin set in
  // Studio once imported, else AGENTBASE_LLM_MODEL from this repo's own .env
  // (see docs/INTEGRATION_AGENTBASE.md §7.9). No vendor key is read anywhere.
  model: resolveAgentModel(AGENT_ID),
  // Local tools, plus the MCP tools for whoever this turn acts for. A function,
  // so Mastra asks per turn (and for the A2A card, which has no caller and gets
  // the container's own toolset).
  tools: async () => ({ exampleTool, ...cardTools, ...(await mcpTools.current()) }),
  // Durable, Postgres-backed conversation memory. Engages only when the caller
  // sends an A2A `contextId` (→ threadId) — see lib/memory.ts for why, and for
  // why the caller must also send a real `resourceId`.
  memory: createAgentMemory(),
});
