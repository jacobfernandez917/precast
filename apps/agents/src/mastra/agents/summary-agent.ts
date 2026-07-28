import { Agent } from '@mastra/core/agent';
import { exampleTool } from '../tools/example-tool';
import { resolveAgentModel } from '../lib/agentbase-model';
import { resolveDefaultModel } from '../lib/default-model';

const AGENT_ID = 'summary-agent';

/**
 * Second placeholder agent — exists only to prove the boilerplate is
 * multi-agent: registering another agent on the Mastra instance
 * (see mastra/index.ts) auto-exposes its own A2A card at
 * `/api/.well-known/summary-agent/agent-card.json`, with no card code to write.
 *
 * Like `example-agent`, it carries no domain. Replace both with your project's
 * real agents, designed from your feed-forward docs (templates/AGENT_SPEC.md).
 */
export const summaryAgent = new Agent({
  id: AGENT_ID,
  name: 'Summary Agent',
  instructions:
    'You are a placeholder assistant used to verify multi-agent wiring. ' +
    'Summarize whatever text you are given in one short sentence.',
  model: resolveAgentModel(AGENT_ID, resolveDefaultModel()),
  tools: { exampleTool },
});
