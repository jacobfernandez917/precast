import { Agent } from '@mastra/core/agent';
import { exampleTool } from '../tools/example-tool';

/**
 * Placeholder agent — proves the Mastra wiring (agent + tool + model gateway)
 * works out of the box. It carries no domain.
 *
 * Replace it with your project's real agents. Design them from your feed-forward
 * docs (see templates/AGENT_SPEC.md) and the tech stack — not from this example.
 */
export const exampleAgent = new Agent({
  id: 'example-agent',
  name: 'Example Agent',
  instructions:
    'You are a placeholder assistant used to verify the boilerplate. ' +
    'Answer briefly. Use the example tool when asked to echo text.',
  model: 'google/gemini-2.5-flash',
  tools: { exampleTool },
});
