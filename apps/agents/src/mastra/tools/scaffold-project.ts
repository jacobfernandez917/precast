import { createHash } from 'node:crypto';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  AgentBaseComputerClient,
  type ComputerCommand,
  type ComputerCommandResult,
} from '../lib/agentbase-computer';
import { currentAgentBaseProof } from '../lib/request-context';
import { resolveAgentMode } from '../lib/agent-mode';
import { createServiceVerifier } from '../lib/service-verification';

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
  services: z.enum(['deferred', 'hannibal-gemini']).default('deferred'),
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
  services: z
    .object({
      projectName: z.string(),
      applicationId: z.string().uuid(),
      model: z.string(),
      geminiCallVerified: z.literal(true),
      database: z.string(),
      databaseVerified: z.literal(true),
      verificationLocation: z.literal('builder-server'),
    })
    .optional(),
});

export async function scaffoldProject(
  input: z.infer<typeof scaffoldProjectInput>,
): Promise<z.infer<typeof scaffoldProjectOutput>> {
  const parsed = scaffoldProjectInput.parse(input);
  const connected = parsed.services === 'hannibal-gemini';
  if (
    connected &&
    (resolveAgentMode() !== 'scaffold-builder' || process.env.PRECAST_SERVICE_SETUP_ENABLED !== '1')
  ) {
    throw new Error(
      'Connected scaffolding is not enabled for this builder. No project or service was created.',
    );
  }
  const proof = currentAgentBaseProof();
  if (!proof.rayaUserDelegation || !proof.agentbaseChain) {
    throw new Error(
      'Scaffolding must be requested from a Raya conversation with approved Computer access.',
    );
  }
  const projectPath = `Projects/${parsed.projectName}`;
  const verifier = connected ? createServiceVerifier(parsed.projectName) : undefined;
  const seed = createHash('sha256')
    .update(
      `${proof.agentbaseChain}\u0000${parsed.projectName}\u0000${parsed.theme}\u0000${parsed.services}`,
    )
    .digest('hex');
  const commands: ComputerCommand[] = [
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
      memoryMiB: 3072,
    },
    {
      id: 'verify',
      label: 'Verify the scaffold',
      executable: 'pnpm' as const,
      argv: ['run', 'verify:poc'],
      cwd: projectPath,
      timeoutMs: 20 * 60_000,
      memoryMiB: 3072,
    },
    {
      id: 'build',
      label: 'Build the scaffold',
      executable: 'pnpm' as const,
      argv: ['run', 'build'],
      cwd: projectPath,
      timeoutMs: 30 * 60_000,
      memoryMiB: 3072,
    },
  ];
  if (verifier)
    commands.splice(2, 0, {
      id: 'services',
      label: 'Connect the approved Hannibal Postgres and Gemini services',
      executable: 'node',
      cwd: projectPath,
      timeoutMs: 10 * 60_000,
      memoryMiB: 512,
      argv: [
        'scripts/setup-services.mjs',
        '--services=hannibal-gemini',
        `--project-name=${parsed.projectName}`,
        `--verification-key=${verifier.publicKey}`,
      ],
      secrets: [
        {
          alias: 'PRECAST_PROJECT_SETUP'.toLowerCase(),
          purpose: `Connect services only for ${parsed.projectName}`,
        },
      ],
    });

  const client = new AgentBaseComputerClient(SCAFFOLD_BUILDER_AGENT_ID);
  const { run, lease } = await client.createRun(seed);
  const steps: ComputerCommandResult[] = [];
  let services: z.infer<typeof scaffoldProjectOutput>['services'];
  try {
    await client.waitUntilRunning(run.id);
    const controlEpoch = await client.takeControl(run.id, lease.id);
    for (const command of commands) {
      const result = await client.runCommand(run.id, lease.id, controlEpoch, command, seed);
      if (command.id === 'services' && verifier) {
        services = await verifier.verify(result.stdout);
        // Only the verified public summary reaches the model. The encrypted receipt stays internal.
        steps.push({
          ...result,
          stdout:
            'Project Application subscribed; Gemini call and scoped Postgres SELECT 1 verified.',
          stderr: '',
        });
      } else steps.push(result);
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
    ...(services ? { services } : {}),
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
