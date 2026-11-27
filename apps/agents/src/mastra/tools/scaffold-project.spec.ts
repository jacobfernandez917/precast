import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const calls = vi.hoisted(() => ({
  onCommand: vi.fn(),
  preflight: vi.fn(),
  commands: [] as Array<{ id: string; argv: string[]; secrets?: unknown }>,
  complete: vi.fn(),
  createRun: vi.fn(),
  verify: vi.fn(),
  projectPreview: vi.fn(),
  writeProjectInput: vi.fn(),
  loadPrdDraft: vi.fn(),
  pendingPrdDraft: vi.fn(),
  settlePrdDraft: vi.fn(),
}));
vi.mock('../lib/agentbase-computer', () => ({
  AgentBaseComputerClient: class {
    createRun = calls.createRun;
    waitUntilRunning = vi.fn();
    takeControl = vi.fn(async () => 1);
    async runCommand(
      _run: string,
      _lease: string,
      _epoch: number,
      command: { id: string; argv: string[]; secrets?: unknown },
    ) {
      calls.commands.push(command);
      calls.onCommand(command);
      if (command.id === 'setup-preflight') return calls.preflight(command);
      return {
        id: command.id,
        label: command.id,
        state: 'succeeded',
        stdout:
          command.id === 'services'
            ? 'encrypted-receipt-private-to-tool'
            : command.id === 'preview'
              ? 'PRECAST_PROJECT_PREVIEW:' +
                JSON.stringify({
                  projectName: 'connected-project',
                  projectPath: 'Projects/connected-project',
                  applicationId: '00000000-0000-4000-8000-000000000001',
                  provider: 'srv.us',
                  url: 'https://abcdefghijklmnopqrstuvwxyz.srv.us',
                  expiresAt: '2026-11-14T00:00:00.000Z',
                  signInRequired: true,
                })
              : '',
        stderr: '',
      };
    }
    complete = calls.complete;
    projectPreview = calls.projectPreview;
    writeProjectInput = calls.writeProjectInput;
  },
}));
vi.mock('../lib/request-context', () => ({
  currentAgentBaseProof: () => ({ rayaUserDelegation: 'delegation', agentbaseChain: 'chain' }),
}));
vi.mock('../lib/service-verification', () => ({
  createServiceVerifier: () => ({ publicKey: 'public-key', verify: calls.verify }),
}));
vi.mock('../lib/prd-drafts', () => ({
  loadPrdDraft: calls.loadPrdDraft,
  pendingPrdDraft: calls.pendingPrdDraft,
  settlePrdDraft: calls.settlePrdDraft,
}));
import { scaffoldProject, scaffoldProjectOutput } from './scaffold-project';
const input = {
  projectName: 'connected-project',
  theme: 'stockholm' as const,
  services: 'hannibal-gemini' as const,
  preview: 'off' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  calls.commands.length = 0;
  calls.onCommand.mockReset();
  calls.preflight.mockResolvedValue({ stdout: 'ready', stderr: '' });
  calls.complete.mockResolvedValue(undefined);
  calls.pendingPrdDraft.mockResolvedValue(undefined);
  calls.settlePrdDraft.mockResolvedValue(undefined);
  calls.createRun.mockResolvedValue({ run: { id: 'run' }, lease: { id: 'lease' } });
  calls.verify.mockResolvedValue({
    projectName: input.projectName,
    applicationId: '00000000-0000-4000-8000-000000000001',
    model: 'gemini-3.5-flash',
    geminiCallVerified: true,
    database: 'project',
    databaseVerified: true,
    verificationLocation: 'builder-server',
  });
  calls.loadPrdDraft.mockResolvedValue({
    sourceName: 'actions.pdf',
    sourceText: 'Exact private PRD source',
    sourceHash: 'a'.repeat(64),
    answers: [],
    analysis: {
      blueprint: { title: 'Action Desk', collections: [{ id: 'actions', label: 'Actions' }] },
      missingQuestions: [],
      unsupportedRequirements: [],
    },
  });
});

describe('AGT-039 PRD Computer orchestration', () => {
  const prdId = '00000000-0000-4000-8000-000000000001';
  it('never falls back to a plain scaffold when a PRD was not read successfully', async () => {
    vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
    calls.pendingPrdDraft.mockResolvedValue({ id: prdId });
    await expect(scaffoldProject(input)).rejects.toThrow(/pending PRD/);
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('refuses a PRD app before creating a run without the gate and connected services', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    await expect(scaffoldProject({ ...input, prdId })).rejects.toThrow(/PRD app building/);
    vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
    await expect(scaffoldProject({ ...input, prdId, services: 'deferred' })).rejects.toThrow(
      /PRD app building/,
    );
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('uploads the exact saved source after bootstrap, applies the product before services, and does not echo the source', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
    calls.writeProjectInput.mockImplementation(async () =>
      expect(calls.commands.map((c) => c.id)).toEqual(['setup-preflight', 'clone', 'bootstrap']),
    );
    const result = await scaffoldProject({ ...input, prdId });
    expect(calls.commands.map((c) => c.id)).toEqual([
      'setup-preflight',
      'clone',
      'bootstrap',
      'product',
      'services',
      'verify',
      'build',
    ]);
    expect(calls.writeProjectInput).toHaveBeenCalledWith(
      'run',
      'lease',
      1,
      'Projects/connected-project/.precast/prd-build.json',
      expect.stringContaining('Exact private PRD source'),
      expect.any(String),
    );
    if (result.state !== 'succeeded') throw new Error('Expected success');
    expect(result.product).toMatchObject({
      title: 'Action Desk',
      sourceName: 'actions.pdf',
      sourceHash: 'a'.repeat(64),
    });
    expect(JSON.stringify(result)).not.toContain('Exact private PRD source');
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('AGT-034 connected scaffold gates', () => {
  it('pins every scaffold to develop and checks an operator-approved revision before bootstrap', async () => {
    vi.stubEnv('PRECAST_TEMPLATE_REVISION', 'a'.repeat(40));
    await scaffoldProject({ projectName: 'revision-probe', services: 'deferred' });
    expect(calls.commands.find((c) => c.id === 'clone')?.argv).toContain('develop');
    expect(calls.commands.find((c) => c.id === 'bootstrap')?.argv).toContain(
      '--expected-template-commit=' + 'a'.repeat(40),
    );
  });
  it('refuses service setup before any Computer run unless builder mode and the operator gate are enabled', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'project');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    await expect(scaffoldProject(input)).rejects.toThrow(/not enabled/);
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '0');
    await expect(scaffoldProject(input)).rejects.toThrow(/not enabled/);
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('keeps a deferred scaffold to the existing four commands with no secret request', async () => {
    await scaffoldProject({ ...input, services: 'deferred' });
    expect(calls.commands.map((c) => c.id)).toEqual(['clone', 'bootstrap', 'verify', 'build']);
    expect(calls.commands.every((c) => c.secrets === undefined)).toBe(true);
    expect(calls.commands.find((c) => c.id === 'bootstrap')?.argv).toContain('--skip-deps');
    expect(calls.commands.find((c) => c.id === 'build')?.argv).toContain('--cache=local:r');
    expect(calls.verify).not.toHaveBeenCalled();
  });
  it('uses the package image only behind its operator gate', async () => {
    await scaffoldProject({ ...input, services: 'deferred' });
    expect(calls.commands.find((c) => c.id === 'bootstrap')?.argv).not.toContain('--package-image');

    calls.commands.length = 0;
    vi.stubEnv('PRECAST_PACKAGE_IMAGE_ENABLED', '1');
    await scaffoldProject({ ...input, services: 'deferred' });
    expect(calls.commands.find((c) => c.id === 'bootstrap')?.argv).toContain('--package-image');
  });
  it('runs connected setup with an alias only, verifies before building and returns no private receipt', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    const result = await scaffoldProject(input);
    expect(calls.commands.map((c) => c.id)).toEqual([
      'setup-preflight',
      'clone',
      'bootstrap',
      'services',
      'verify',
      'build',
    ]);
    expect(calls.commands.find((c) => c.id === 'services')?.secrets).toEqual([
      {
        alias: 'PRECAST_PROJECT_SETUP'.toLowerCase(),
        purpose: 'Connect services only for connected-project',
        project: 'connected-project',
      },
    ]);
    expect(calls.verify).toHaveBeenCalledWith('encrypted-receipt-private-to-tool');
    if (result.state !== 'succeeded') throw new Error('Expected success');
    expect(result.services?.databaseVerified).toBe(true);
    expect(JSON.stringify(result)).not.toContain('encrypted-receipt-private-to-tool');
  });
  it('stops and records failure when service verification fails', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    calls.verify.mockRejectedValue(new Error('verification refused'));
    const result = await scaffoldProject(input);
    expect(result).toMatchObject({
      state: 'recovery_required',
      failedStage: 'service-verification',
      serviceEffects: 'review_required',
      rollback: 'not_attempted',
    });
    expect(calls.commands.map((c) => c.id)).toEqual([
      'setup-preflight',
      'clone',
      'bootstrap',
      'services',
    ]);
    expect(calls.complete).toHaveBeenCalledWith(
      'run',
      'lease',
      'failed',
      expect.stringContaining('No cleanup was attempted'),
    );
    expect(JSON.stringify(result)).not.toContain('verification refused');
  });
});

describe('AGT-035 automatic public preview', () => {
  it('refuses the default public preview before creating a run when its separate gate is missing', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    await expect(scaffoldProject({ ...input, preview: undefined })).rejects.toThrow(/preview gate/);
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('keeps a default deferred scaffold private without preview approval or secret access', async () => {
    const result = await scaffoldProject({ projectName: 'deferred-project' });
    expect(calls.commands.map((c) => c.id)).toEqual(['clone', 'bootstrap', 'verify', 'build']);
    expect(calls.commands.every((c) => c.secrets === undefined)).toBe(true);
    expect(calls.projectPreview).not.toHaveBeenCalled();
    if (result.state !== 'succeeded') throw new Error('Expected success');
    expect(result.preview).toBeUndefined();
    expect(result.services).toBeUndefined();
  });
  it('starts the connected app by default after exact authorization and returns the verified owner preview', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    vi.stubEnv('PRECAST_PROJECT_PREVIEW_ENABLED', '1');
    calls.projectPreview.mockImplementation(async (_run, stage) =>
      stage === 'authorize'
        ? {
            provider: 'srv.us',
            projectPath: 'Projects/connected-project',
            applicationId: '00000000-0000-4000-8000-000000000001',
            expiresAt: '2026-11-14T00:00:00.000Z',
          }
        : {
            provider: 'srv.us',
            url: 'https://abcdefghijklmnopqrstuvwxyz.srv.us',
            expiresAt: '2026-11-14T00:00:00.000Z',
            signInRequired: true,
          },
    );
    const result = await scaffoldProject({ ...input, preview: undefined });
    expect(calls.commands.map((c) => c.id)).toEqual([
      'setup-preflight',
      'clone',
      'bootstrap',
      'services',
      'verify',
      'build',
      'preview',
    ]);
    expect(calls.projectPreview.mock.calls.map((c) => c[1])).toEqual(['authorize', 'handoff']);
    if (result.state !== 'succeeded') throw new Error('Expected success');
    expect(result.preview?.url).toBe('https://abcdefghijklmnopqrstuvwxyz.srv.us');
    expect(result.steps.at(-1)?.stdout).not.toContain('PRECAST_PROJECT_PREVIEW:');
    expect(calls.complete).not.toHaveBeenCalled();
  });
  it('does not start the app or return a URL after an approval refusal', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    vi.stubEnv('PRECAST_PROJECT_PREVIEW_ENABLED', '1');
    calls.projectPreview.mockRejectedValue(new Error('preview approval refused'));
    const result = await scaffoldProject({ ...input, preview: 'srv.us' });
    expect(result).toMatchObject({
      state: 'recovery_required',
      failedStage: 'preview-authorization',
      rollback: 'not_attempted',
    });
    expect(calls.commands.some((c) => c.id === 'preview')).toBe(false);
    expect(calls.complete).toHaveBeenCalledWith(
      'run',
      'lease',
      'failed',
      expect.stringContaining('No cleanup was attempted'),
    );
  });
});

describe('AGT-044 existing database execution fence', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('blocks the provisioning path before a Computer run in existing-only mode', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', 'existing');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    await expect(scaffoldProject(input)).rejects.toThrow(/operator-approved mode/);
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('blocks existing-database execution unless the operator enabled that mode', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', 'provision');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    await expect(
      scaffoldProject({ ...input, services: 'existing-postgres-gemini' }),
    ).rejects.toThrow(/operator-approved mode/);
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('passes only the fixed reuse command under the existing service credential lease', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', 'existing');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    const result = await scaffoldProject({ ...input, services: 'existing-postgres-gemini' });
    const command = calls.commands.find((c) => c.id === 'services') as unknown as {
      argv: string[];
    };
    expect(command.argv).toContain('--services=existing-postgres-gemini');
    expect(command.argv).not.toContain('--services=hannibal-gemini');
    if (result.state !== 'succeeded') throw new Error('Expected success');
    expect(result.services?.databaseVerified).toBe(true);
  });
});

describe('AGT-049 preflight before the first project write', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
  });

  it.each(['mismatch', 'missing', 'expired', 'wrong-kind', 'matched', 'prd-mismatch'])(
    '%s runs the fixed program in a VM before any simulated clone',
    async (scenario) => {
      const root = mkdtempSync(join(tmpdir(), 'precast-preflight-'));
      roots.push(root);
      const projects = join(root, 'Projects');
      mkdirSync(projects);
      const project = join(projects, input.projectName);
      const required = [
        'applicationId',
        'clientId',
        'clientSecret',
        'apiUrl',
        'tokenUrl',
        'modelSlug',
        'modelId',
        'modelListingId',
        'modelOrg',
        'hannibalSlug',
        'hannibalListingId',
        'hannibalOrg',
        'databaseHost',
      ];
      const grant = {
        ...Object.fromEntries(required.map((key) => [key, `SYNTHETIC_${key}`])),
        projectName: scenario.includes('mismatch') ? 'previous-project' : input.projectName,
        expiresAt: new Date(
          Date.now() + (scenario === 'expired' ? -3600000 : 3600000),
        ).toISOString(),
      };
      const credential = join(root, 'synthetic-descriptor');
      writeFileSync(
        credential,
        scenario === 'wrong-kind' ? '{"token":"SYNTHETIC_SECRET"}' : JSON.stringify(grant),
      );
      calls.preflight.mockImplementation((command: { argv: string[] }) => {
        const fd = openSync(credential, 'r');
        try {
          let stdout = '';
          runInNewContext(command.argv[1], {
            Buffer,
            require: (module: string) => {
              expect(module).toBe('node:fs');
              return {
                readSync: (descriptor: number, buffer: Buffer, offset: number, length: number) => {
                  expect(descriptor).toBe(3);
                  return readSync(fd, buffer, offset, length, null);
                },
              };
            },
            process: {
              argv: ['node', ...command.argv.slice(2)],
              env:
                scenario === 'missing'
                  ? {}
                  : { ['RAYA_SECRET_FD_' + 'PRECAST_PROJECT_SETUP']: '3' },
              stdout: {
                write: (value: string) => {
                  stdout += value;
                },
              },
            },
          });
          return { stdout, stderr: '' };
        } finally {
          closeSync(fd);
        }
      });
      calls.onCommand.mockImplementation((command: { id: string }) => {
        if (command.id === 'clone') mkdirSync(project);
      });
      const prd = scenario === 'prd-mismatch';
      if (prd) vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
      const result = await scaffoldProject({
        ...input,
        ...(prd ? { prdId: '00000000-0000-4000-8000-000000000001' } : {}),
      });
      expect(scaffoldProjectOutput.safeParse(result).success).toBe(true);
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_');
      expect(JSON.stringify(calls.commands)).not.toContain('SYNTHETIC_');
      expect(JSON.stringify(calls.complete.mock.calls)).not.toContain('SYNTHETIC_');
      if (scenario === 'matched') {
        expect(result.state).toBe('succeeded');
        expect(existsSync(project)).toBe(true);
        expect(calls.commands.map((c) => c.id)).toEqual([
          'setup-preflight',
          'clone',
          'bootstrap',
          'services',
          'verify',
          'build',
        ]);
      } else {
        expect(result).toMatchObject({
          state: 'blocked',
          code: scenario.includes('mismatch')
            ? 'setup_project_mismatch'
            : scenario === 'missing'
              ? 'setup_secret_not_granted'
              : scenario === 'expired'
                ? 'setup_grant_expired'
                : 'invalid_setup_grant',
          projectName: input.projectName,
          projectPath: `Projects/${input.projectName}`,
          projectCreated: false,
          nextAction: 'Configure project access',
        });
        expect(existsSync(project)).toBe(false);
        expect(readdirSync(projects)).toEqual([]);
        // T-344: AgentBase records the block for exactly this project, so Raya can offer the step.
        expect(calls.complete).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'failed',
          expect.any(String),
          { code: (result as { code: string }).code, projectName: input.projectName },
        );
        expect(calls.commands.map((c) => c.id)).toEqual(['setup-preflight']);
        expect(calls.writeProjectInput).not.toHaveBeenCalled();
        expect(calls.settlePrdDraft).not.toHaveBeenCalled();
        expect(calls.verify).not.toHaveBeenCalled();
        expect(calls.projectPreview).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['approval', 'unsupported', 'expired-lease', 'malformed', 'stderr'])(
    'fails closed without exposing upstream details when preflight is %s',
    async (scenario) => {
      if (scenario === 'malformed')
        calls.preflight.mockResolvedValue({ stdout: 'ready\nSYNTHETIC_SECRET', stderr: '' });
      else if (scenario === 'stderr')
        calls.preflight.mockResolvedValue({ stdout: 'ready', stderr: 'SYNTHETIC_SECRET' });
      else calls.preflight.mockRejectedValue(new Error(`SYNTHETIC_SECRET ${scenario}`));
      const result = await scaffoldProject(input);
      expect(result).toMatchObject({ state: 'blocked', code: 'setup_preflight_unavailable' });
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
      expect(JSON.stringify(calls.complete.mock.calls)).not.toContain('SYNTHETIC_SECRET');
      expect(calls.commands.map((c) => c.id)).toEqual(['setup-preflight']);
      expect(calls.writeProjectInput).not.toHaveBeenCalled();
      expect(calls.verify).not.toHaveBeenCalled();
    },
  );
});

describe('AGT-051 failed attempts preserve unproven project contents', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it.each([
    'deterministic-bootstrap',
    'pre-existing',
    'pre-existing-empty',
    'user-modified',
    'clone-outcome-unknown',
    'service-outcome-unknown',
    'prd-write-failure',
    'completion-unknown',
  ])('preserves %s without cleanup, retry, external UI or invented ownership', async (scenario) => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    const parent = mkdtempSync(join(tmpdir(), 'precast-recovery-'));
    roots.push(parent);
    const project = join(parent, input.projectName);
    const record = join(project, 'record.txt');
    const existing = scenario.startsWith('pre-existing');
    if (existing) {
      mkdirSync(project);
      if (scenario === 'pre-existing') writeFileSync(record, 'existing user content');
    }
    let syntheticServiceEffects = 0;
    calls.onCommand.mockImplementation((command: { id: string }) => {
      if (command.id === 'clone') {
        if (existing) throw new Error('clone refused: existing directory');
        mkdirSync(project);
        writeFileSync(record, 'attempt content');
        if (scenario === 'clone-outcome-unknown') throw new Error('reply lost');
      }
      if (command.id === 'bootstrap' && scenario === 'deterministic-bootstrap')
        throw new Error('deterministic exit 2 SYNTHETIC_PRIVATE_DETAIL');
      if (command.id === 'verify' && scenario === 'user-modified') {
        writeFileSync(record, 'user changed this');
        throw new Error('deterministic verification failure');
      }
      if (command.id === 'services' && scenario === 'service-outcome-unknown') {
        syntheticServiceEffects += 1;
        throw new Error('subscription may exist SYNTHETIC_PRIVATE_DETAIL');
      }
    });
    const prd = scenario === 'prd-write-failure';
    if (prd) {
      vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
      calls.writeProjectInput.mockRejectedValueOnce(new Error('input write failed'));
    }
    if (scenario === 'completion-unknown')
      calls.complete.mockRejectedValueOnce(new Error('completion reply lost'));
    const connected = prd || scenario === 'service-outcome-unknown';
    const result = await scaffoldProject({
      ...input,
      services: connected ? input.services : 'deferred',
      ...(prd ? { prdId: '00000000-0000-4000-8000-000000000001' } : {}),
    });
    expect(scaffoldProjectOutput.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      state: 'recovery_required',
      code: 'scaffold_preserved',
      projectName: input.projectName,
      projectPath: `Projects/${input.projectName}`,
      filesystem: 'preserved_uninspected',
      creationOwnership: 'unproven',
      rollback: 'not_attempted',
      rollbackReason: 'conditional_rollback_unavailable',
      serviceEffects: scenario === 'service-outcome-unknown' ? 'review_required' : 'not_requested',
      automaticRetry: false,
      nextAction: 'Review preserved project',
    });
    expect(existsSync(project)).toBe(true);
    if (scenario === 'pre-existing-empty') expect(readdirSync(project)).toEqual([]);
    else
      expect(readFileSync(record, 'utf8')).toBe(
        scenario === 'pre-existing'
          ? 'existing user content'
          : scenario === 'user-modified'
            ? 'user changed this'
            : 'attempt content',
      );
    expect(syntheticServiceEffects).toBe(scenario === 'service-outcome-unknown' ? 1 : 0);
    expect(calls.commands.filter((c) => c.id === 'clone')).toHaveLength(1);
    expect(
      calls.commands.every((c) =>
        ['setup-preflight', 'clone', 'bootstrap', 'services', 'verify', 'build'].includes(c.id),
      ),
    ).toBe(true);
    expect(calls.projectPreview).not.toHaveBeenCalled();
    expect(calls.settlePrdDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
    expect(JSON.stringify(calls.complete.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
  });
});
