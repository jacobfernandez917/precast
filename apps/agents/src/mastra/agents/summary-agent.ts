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
 *
 * NO `memory:` — deliberately, and this is the useful half of the contrast with
 * `example-agent`. Summarizing is a pure function of the text handed in: the
 * same input should produce the same summary whether it is the first call or
 * the thousandth. Giving this agent memory would make its output depend on
 * conversation history that has nothing to do with the passage being
 * summarized, and would grow a thread per caller for no benefit.
 *
 * Rule of thumb: attach memory to agents that hold a *conversation*, not to
 * agents that perform a *transformation*.
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
