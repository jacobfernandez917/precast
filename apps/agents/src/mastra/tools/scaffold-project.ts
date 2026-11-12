import { createHash } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentBaseComputerClient, type ComputerCommandResult } from '../lib/agentbase-computer';
import { currentAgentBaseProof } from '../lib/request-context';

export const SCAFFOLD_BUILDER_AGENT_ID = 'scaffold-builder';
const TEMPLATE_REPOSITORY =
  process.env.PRECAST_TEMPLATE_REPOSITORY?.trim() ||
  'https://github.com/jacobfernandez917/precast.git';

export const scaffoldProjectInput = z.object({
  projectName: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,62}$/, 'Use 2–63 lowercase letters, digits, and hyphens.'),
  theme: z
    .enum(['stockholm', 'prague', 'arctic', 'nova', 'melbourne', 'lapland', 'cappadocia'])
    .default('stockholm'),
});

const commandResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.literal('succeeded'),
  stdout: z.string(),
  stderr: z.string(),
});

export const scaffoldProjectOutput = z.object({
  projectName: z.string(),
  projectPath: z.string(),
  theme: z.string(),
  state: z.literal('succeeded'),
  steps: z.array(commandResultSchema),
});

export async function scaffoldProject(
  input: z.infer<typeof scaffoldProjectInput>,
): Promise<z.infer<typeof scaffoldProjectOutput>> {
  const parsed = scaffoldProjectInput.parse(input);
  const proof = currentAgentBaseProof();
  if (!proof.rayaUserDelegation || !proof.agentbaseChain) {
    throw new Error(
      'Scaffolding must be requested from a Raya conversation with approved Computer access.',
    );
  }
  const projectPath = `Projects/${parsed.projectName}`;
  const seed = createHash('sha256')
    .update(`${proof.agentbaseChain}\u0000${parsed.projectName}\u0000${parsed.theme}`)
    .digest('hex');
  const commands = [
    {
      id: 'clone',
      label: 'Clone the Precast template',
      executable: 'git' as const,
      argv: ['clone', '--depth', '1', TEMPLATE_REPOSITORY, parsed.projectName],
      cwd: 'Projects',
      timeoutMs: 5 * 60_000,
    },
    {
      id: 'bootstrap',
      label: 'Bootstrap the project',
      executable: 'pnpm' as const,
      argv: [
        'run',
        'bootstrap',
        '--',
        parsed.projectName,
        '--yes',
        '--llm-provider=skip',
        '--db=later',
        `--theme=${parsed.theme}`,
      ],
      cwd: projectPath,
      timeoutMs: 30 * 60_000,
    },
    {
      id: 'verify',
      label: 'Verify the scaffold',
      executable: 'pnpm' as const,
      argv: ['run', 'verify:poc'],
      cwd: projectPath,
      timeoutMs: 20 * 60_000,
    },
    {
      id: 'build',
      label: 'Build the scaffold',
      executable: 'pnpm' as const,
      argv: ['run', 'build'],
      cwd: projectPath,
      timeoutMs: 30 * 60_000,
    },
  ];

  const client = new AgentBaseComputerClient(SCAFFOLD_BUILDER_AGENT_ID);
  const { run, lease } = await client.createRun(seed);
  const steps: ComputerCommandResult[] = [];
  try {
    await client.waitUntilRunning(run.id);
    const controlEpoch = await client.takeControl(run.id, lease.id);
    for (const command of commands) {
      steps.push(await client.runCommand(run.id, lease.id, controlEpoch, command, seed));
    }
    await client.complete(run.id, lease.id, 'succeeded', `Created and verified ${projectPath}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.complete(run.id, lease.id, 'failed', message).catch(() => undefined);
    throw error;
  }
  return {
    projectName: parsed.projectName,
    projectPath,
    theme: parsed.theme,
    state: 'succeeded',
    steps,
  };
}

export const scaffoldProjectTool = createTool({
  id: 'scaffold-precast-project',
  description:
    'Create one new Precast project in the member Computer Projects folder, then verify and build it. Use only after the user explicitly asks to scaffold a project.',
  inputSchema: scaffoldProjectInput,
  outputSchema: scaffoldProjectOutput,
  execute: async (input) => scaffoldProject(input),
});
