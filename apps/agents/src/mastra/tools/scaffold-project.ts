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
import { loadPrdDraft, pendingPrdDraft, settlePrdDraft } from '../lib/prd-drafts';
import { resolveDatabaseSetupMode } from '../lib/database-setup-mode';
import { preserveScaffold, scaffoldRecovery } from '../lib/scaffold-recovery';
import {
  configureProjectAccess,
  projectAccessRequired,
  projectSetupPreflightCommand,
  setupPreflightStatus,
} from '../lib/project-setup-preflight';

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
  services: z.enum(['deferred', 'hannibal-gemini', 'existing-postgres-gemini']).default('deferred'),
  preview: z.enum(['off', 'srv.us']).default('srv.us'),
  prdId: z.string().uuid().optional(),
});

const commandResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.literal('succeeded'),
  stdout: z.string(),
  stderr: z.string(),
});

const scaffoldProjectSuccess = z.object({
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
      databaseReused: z.literal(true).optional(),
      hannibalInvoked: z.literal(false).optional(),
    })
    .optional(),
  preview: z
    .object({
      provider: z.literal('srv.us'),
      url: z.string().regex(/^https:\/\/[a-z2-7]{26}\.srv\.us$/),
      expiresAt: z.string().datetime(),
      signInRequired: z.literal(true),
    })
    .strict()
    .optional(),
  product: z
    .object({
      title: z.string(),
      sourceName: z.string(),
      sourceHash: z.string(),
      collections: z.array(z.string()),
      documents: z.array(z.string()),
    })
    .optional(),
});

export const scaffoldProjectOutput = z.discriminatedUnion('state', [
  scaffoldProjectSuccess,
  projectAccessRequired,
  scaffoldRecovery,
]);

export async function scaffoldProject(
  input: z.input<typeof scaffoldProjectInput>,
): Promise<z.infer<typeof scaffoldProjectOutput>> {
  const parsed = scaffoldProjectInput.parse(input);
  const templateRevision = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional()
    .parse(process.env.PRECAST_TEMPLATE_REVISION?.trim() || undefined);
  if (!parsed.prdId && process.env.PRECAST_PRD_BUILD_ENABLED === '1' && (await pendingPrdDraft()))
    throw new Error(
      'This conversation has a pending PRD. Read it successfully and include its draft ID, or explicitly discard it before a plain scaffold. No project was created.',
    );
  const connected = parsed.services !== 'deferred';
  const reuse = parsed.services === 'existing-postgres-gemini';
  if (connected && (resolveDatabaseSetupMode() === 'existing') !== reuse)
    throw new Error(
      'The requested database setup does not match the operator-approved mode. No project, subscription or database was created.',
    );
  const draft = parsed.prdId ? await loadPrdDraft(parsed.prdId) : undefined;
  if (
    draft &&
    (resolveAgentMode() !== 'scaffold-builder' ||
      process.env.PRECAST_PRD_BUILD_ENABLED !== '1' ||
      !connected)
  )
    throw new Error(
      'PRD app building requires the enabled builder gate and approved Gemini/Postgres connections. No project was created.',
    );
  if (
    draft &&
    (!draft.analysis.blueprint ||
      draft.analysis.missingQuestions.length ||
      draft.analysis.unsupportedRequirements.length)
  )
    throw new Error(
      'Resolve the missing or unsupported PRD requirements before building. No project was created.',
    );
  const previewRequested = connected && parsed.preview === 'srv.us';
  if (
    previewRequested &&
    (resolveAgentMode() !== 'scaffold-builder' ||
      process.env.PRECAST_PROJECT_PREVIEW_ENABLED !== '1')
  )
    throw new Error(
      'A public preview requires approved connected scaffolding and the enabled preview gate. No project was created.',
    );
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
  const verifier = connected ? createServiceVerifier(parsed.projectName, reuse) : undefined;
  const seed = createHash('sha256')
    .update(
      `${proof.agentbaseChain}\u0000${parsed.projectName}\u0000${parsed.theme}\u0000${parsed.services}\u0000${parsed.preview}\u0000${draft?.sourceHash ?? ''}`,
    )
    .digest('hex');
  const commands: ComputerCommand[] = [
    {
      id: 'clone',
      label: 'Clone the Precast template',
      executable: 'git' as const,
      argv: [
        'clone',
        '--depth',
        '1',
        '--branch',
        'develop',
        TEMPLATE_REPOSITORY,
        parsed.projectName,
      ],
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
        '--skip-deps',
        ...(process.env.PRECAST_PACKAGE_IMAGE_ENABLED === '1' ? ['--package-image'] : []),
        '--llm-provider=skip',
        '--db=later',
        `--theme=${parsed.theme}`,
        ...(templateRevision ? [`--expected-template-commit=${templateRevision}`] : []),
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
      // A fresh scaffold is built once. Read matching caches but do not archive a
      // second copy of its complete runtime dependencies into the member's disk.
      argv: ['run', 'build', '--cache=local:r'],
      cwd: projectPath,
      timeoutMs: 30 * 60_000,
      memoryMiB: 3072,
    },
  ];
  if (verifier)
    commands.splice(2, 0, {
      id: 'services',
      label: reuse
        ? 'Connect Gemini and reuse the approved existing Postgres database'
        : 'Connect the approved Hannibal Postgres and Gemini services',
      executable: 'node',
      cwd: projectPath,
      timeoutMs: 10 * 60_000,
      memoryMiB: 512,
      argv: [
        'scripts/setup-services.mjs',
        `--services=${parsed.services}`,
        `--project-name=${parsed.projectName}`,
        `--verification-key=${verifier.publicKey}`,
      ],
      secrets: [
        {
          alias: 'PRECAST_PROJECT_SETUP'.toLowerCase(),
          purpose: `Connect services only for ${parsed.projectName}`,
          project: parsed.projectName,
        },
      ],
    });
  if (draft)
    commands.splice(2, 0, {
      id: 'product',
      label: 'Build the product from its PRD',
      executable: 'node',
      argv: ['scripts/apply-prd.mjs', `--project-name=${parsed.projectName}`],
      cwd: projectPath,
      timeoutMs: 60_000,
    });

  const client = new AgentBaseComputerClient(SCAFFOLD_BUILDER_AGENT_ID);
  const { run, lease } = await client.createRun(seed);
  const steps: ComputerCommandResult[] = [];
  let services: z.infer<typeof scaffoldProjectSuccess>['services'];
  let preview: z.infer<typeof scaffoldProjectSuccess>['preview'];
  let failedStage: z.infer<typeof scaffoldRecovery>['failedStage'] = 'admission';
  let projectWriteAttempted = false;
  let serviceSetupAttempted = false;
  try {
    await client.waitUntilRunning(run.id);
    failedStage = 'control';
    const controlEpoch = await client.takeControl(run.id, lease.id);
    if (parsed.services !== 'deferred') {
      let status: z.infer<typeof projectAccessRequired>['code'] | 'ready';
      try {
        const result = await client.runCommand(
          run.id,
          lease.id,
          controlEpoch,
          projectSetupPreflightCommand(parsed.projectName, parsed.services),
          seed,
        );
        const checked = setupPreflightStatus.safeParse(result.stdout);
        status =
          checked.success && result.stderr === '' ? checked.data : 'setup_preflight_unavailable';
      } catch {
        // Never forward descriptor, policy, transport or process error bodies.
        status = 'setup_preflight_unavailable';
      }
      if (status !== 'ready') {
        const blocked = configureProjectAccess(parsed.projectName, status);
        await client
          .complete(run.id, lease.id, 'failed', blocked.message, {
            code: status,
            projectName: parsed.projectName,
          })
          .catch(() => undefined);
        return blocked;
      }
    }
    for (const command of commands) {
      if (command.id === 'product' && draft) {
        failedStage = 'product-input';
        await client.writeProjectInput(
          run.id,
          lease.id,
          controlEpoch,
          `${projectPath}/.precast/prd-build.json`,
          JSON.stringify({
            projectName: parsed.projectName,
            sourceName: draft.sourceName,
            sourceText: draft.sourceText,
            sourceHash: draft.sourceHash,
            blueprint: draft.analysis.blueprint,
            clarifications: draft.answers,
          }),
          seed,
        );
      }
      failedStage = scaffoldRecovery.shape.failedStage.parse(command.id);
      projectWriteAttempted = true;
      if (command.id === 'services') serviceSetupAttempted = true;
      const result = await client.runCommand(run.id, lease.id, controlEpoch, command, seed);
      if (command.id === 'services' && verifier) {
        failedStage = 'service-verification';
        services = await verifier.verify(result.stdout);
        // Only the verified public summary reaches the model. The encrypted receipt stays internal.
        steps.push({
          ...result,
          stdout: reuse
            ? 'Project Application subscribed to Gemini only; real model call and scoped existing Postgres verified. No Hannibal call or database provisioning.'
            : 'Project Application subscribed; Gemini call and scoped Postgres SELECT 1 verified.',
          stderr: '',
        });
      } else steps.push(result);
    }
    if (previewRequested) {
      if (!services) throw new Error('A public preview needs verified project services.');
      const binding = {
        leaseId: lease.id,
        projectPath,
        applicationId: services.applicationId,
        controlEpoch,
      };
      failedStage = 'preview-authorization';
      const approval = await client.projectPreview(run.id, 'authorize', binding);
      if (
        approval.provider !== 'srv.us' ||
        approval.projectPath !== projectPath ||
        approval.applicationId !== services.applicationId ||
        !Number.isFinite(Date.parse(approval.expiresAt))
      )
        throw new Error('The preview authorization did not match this connected project.');
      failedStage = 'preview';
      const result = await client.runCommand(
        run.id,
        lease.id,
        controlEpoch,
        {
          id: 'preview',
          label: 'Start the connected app and its approved public preview',
          executable: 'node',
          cwd: projectPath,
          timeoutMs: 5 * 60_000,
          memoryMiB: 3072,
          argv: [
            'scripts/start-project-preview.mjs',
            '--provider=srv.us',
            `--project-name=${parsed.projectName}`,
            `--expires-at=${approval.expiresAt}`,
          ],
          secrets: [
            {
              alias: 'PRECAST_PROJECT_PREVIEW'.toLowerCase(),
              purpose: `Publish only the approved preview for ${parsed.projectName}`,
            },
          ],
        },
        seed,
      );
      const line = result.stdout
        .split('\n')
        .find((value) => value.startsWith('PRECAST_PROJECT_PREVIEW:'));
      const report = z
        .object({
          projectName: z.literal(parsed.projectName),
          projectPath: z.literal(projectPath),
          applicationId: z.literal(services.applicationId),
          provider: z.literal('srv.us'),
          url: z.string().regex(/^https:\/\/[a-z2-7]{26}\.srv\.us$/),
          expiresAt: z.literal(approval.expiresAt),
          signInRequired: z.literal(true),
        })
        .strict()
        .parse(JSON.parse(line?.slice('PRECAST_PROJECT_PREVIEW:'.length) ?? '{}'));
      failedStage = 'preview-handoff';
      const ready = await client.projectPreview(run.id, 'handoff', { ...binding, url: report.url });
      preview = scaffoldProjectSuccess.shape.preview.unwrap().parse(ready);
      if (preview.url !== report.url || preview.expiresAt !== approval.expiresAt)
        throw new Error('The handed-over preview changed its URL or approval window.');
      steps.push({
        ...result,
        stdout: 'The connected app is running with a verified public sign-in URL.',
        stderr: '',
      });
    } else {
      failedStage = 'complete';
      await client.complete(run.id, lease.id, 'succeeded', `Created and verified ${projectPath}.`);
    }
    if (draft) {
      failedStage = 'prd-settlement';
      await settlePrdDraft(draft.id, 'complete');
    }
  } catch {
    const recovery = preserveScaffold(
      parsed.projectName,
      failedStage,
      projectWriteAttempted,
      serviceSetupAttempted,
    );
    await client.complete(run.id, lease.id, 'failed', recovery.message).catch(() => undefined);
    return recovery;
  }
  return {
    projectName: parsed.projectName,
    projectPath,
    theme: parsed.theme,
    state: 'succeeded',
    steps,
    ...(services ? { services } : {}),
    ...(preview ? { preview } : {}),
    ...(draft?.analysis.blueprint
      ? {
          product: {
            title: draft.analysis.blueprint.title,
            sourceName: draft.sourceName,
            sourceHash: draft.sourceHash,
            collections: draft.analysis.blueprint.collections.map((c) => c.label),
            documents: [
              'docs/PRD.md',
              'docs/DATA_MODEL.md',
              'docs/AGENT_SPEC.md',
              'docs/DESIGN_SYSTEM.md',
            ],
          },
        }
      : {}),
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
