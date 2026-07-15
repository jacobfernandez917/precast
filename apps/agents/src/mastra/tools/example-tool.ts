import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Placeholder tool — the minimal shape of a Mastra tool (zod-validated input /
 * output + an `execute`). It carries no domain; it just echoes its input so the
 * agent has something to call.
 *
 * Replace with your project's real tools. The logic lives in a plain function
 * (`echo`) so it unit-tests without the Mastra runtime; the tool is a thin
 * wrapper. Design tools from your feed-forward docs (templates/AGENT_SPEC.md,
 * templates/DATA_MODEL.md), not from this example.
 */
export const echoInput = z.object({
  message: z.string().describe('Text to echo back'),
});

export function echo(input: z.infer<typeof echoInput>): { echoed: string } {
  return { echoed: input.message };
}

export const exampleTool = createTool({
  id: 'example-echo',
  description: 'Echo the given text back. Placeholder — replace with a real tool.',
  inputSchema: echoInput,
  outputSchema: z.object({ echoed: z.string() }),
  execute: async (input) => echo(input),
});
