import { Agent } from '@mastra/core/agent';
import { exampleTool } from '../tools/example-tool';
import { resolveAgentModel } from '../lib/agentbase-model';
import { resolveDefaultModel } from '../lib/default-model';

const AGENT_ID = 'example-agent';

/**
 * Placeholder agent — proves the Mastra wiring (agent + tool + model gateway)
 * works out of the box. It carries no domain.
 *
 * Replace it with your project's real agents. Design them from your feed-forward
 * docs (see templates/AGENT_SPEC.md) and the tech stack — not from this example.
 */
export const exampleAgent = new Agent({
  id: AGENT_ID,
  name: 'Example Agent',
  instructions:
    'You are a placeholder assistant used to verify the boilerplate. ' +
    'Answer briefly. Use the example tool when asked to echo text.',
  // Uses AgentBase's LLM gateway when imported + org-admin-configured
  // (see docs/INTEGRATION_AGENTBASE.md); otherwise resolveDefaultModel()
  // auto-detects from whichever provider key is set in this repo's own
  // `.env` (Anthropic, OpenAI, or Google — see default-model.ts).
  model: resolveAgentModel(AGENT_ID, resolveDefaultModel()),
  tools: { exampleTool },
});
