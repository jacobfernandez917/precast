import { Agent } from '@mastra/core/agent';
import { exampleTool } from '../tools/example-tool';
import { resolveAgentModel } from '../lib/agentbase-model';
import { resolveDefaultModel } from '../lib/default-model';
import { createAgentMemory } from '../lib/memory';
import { resolveAgentMcpTools } from '../lib/agentbase-mcp';

const AGENT_ID = 'example-agent';

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
    'recalling it from the transcript later.',
  // Uses AgentBase's LLM gateway when imported + org-admin-configured
  // (see docs/INTEGRATION_AGENTBASE.md); otherwise resolveDefaultModel()
  // auto-detects from whichever provider key is set in this repo's own
  // `.env` (Anthropic, OpenAI, or Google — see default-model.ts).
  model: resolveAgentModel(AGENT_ID, resolveDefaultModel()),
  // Local tools, plus whatever MCP servers AgentBase says this agent is
  // subscribed to. TOP-LEVEL AWAIT is deliberate: the toolset is part of the
  // agent's identity, so it must be settled before the agent is constructed and
  // its A2A card is served. On a hosted container a discovery failure therefore
  // fails the BOOT — loudly, in AgentBase's build/runtime logs — rather than
  // quietly serving an agent that is missing half its capabilities and will
  // answer confidently without them. Off AgentBase this resolves to `{}` and
  // costs nothing (see lib/agentbase-mcp.ts).
  tools: { exampleTool, ...(await resolveAgentMcpTools(AGENT_ID)) },
  // Durable, Postgres-backed conversation memory. Engages only when the caller
  // sends an A2A `contextId` (→ threadId) — see lib/memory.ts for why, and for
  // why the caller must also send a real `resourceId`.
  memory: createAgentMemory(),
});
