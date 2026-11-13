import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; secrets?: unknown }>,
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
      command: { id: string; secrets?: unknown },
    ) {
      calls.commands.push(command);
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
import { scaffoldProject } from './scaffold-project';
const input = {
  projectName: 'connected-project',
  theme: 'stockholm' as const,
  services: 'hannibal-gemini' as const,
  preview: 'off' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  calls.commands.length = 0;
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
      expect(calls.commands.map((c) => c.id)).toEqual(['clone', 'bootstrap']),
    );
    const result = await scaffoldProject({ ...input, prdId });
    expect(calls.commands.map((c) => c.id)).toEqual([
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
    expect(calls.verify).not.toHaveBeenCalled();
  });
  it('runs connected setup with an alias only, verifies before building and returns no private receipt', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    const result = await scaffoldProject(input);
    expect(calls.commands.map((c) => c.id)).toEqual([
      'clone',
      'bootstrap',
      'services',
      'verify',
      'build',
    ]);
    expect(calls.commands[2].secrets).toEqual([
      {
        alias: 'PRECAST_PROJECT_SETUP'.toLowerCase(),
        purpose: 'Connect services only for connected-project',
      },
    ]);
    expect(calls.verify).toHaveBeenCalledWith('encrypted-receipt-private-to-tool');
    expect(result.services?.databaseVerified).toBe(true);
    expect(JSON.stringify(result)).not.toContain('encrypted-receipt-private-to-tool');
  });
  it('stops and records failure when service verification fails', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    calls.verify.mockRejectedValue(new Error('verification refused'));
    await expect(scaffoldProject(input)).rejects.toThrow('verification refused');
    expect(calls.commands.map((c) => c.id)).toEqual(['clone', 'bootstrap', 'services']);
    expect(calls.complete).toHaveBeenCalledWith('run', 'lease', 'failed', 'verification refused');
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
      'clone',
      'bootstrap',
      'services',
      'verify',
      'build',
      'preview',
    ]);
    expect(calls.projectPreview.mock.calls.map((c) => c[1])).toEqual(['authorize', 'handoff']);
    expect(result.preview?.url).toBe('https://abcdefghijklmnopqrstuvwxyz.srv.us');
    expect(result.steps.at(-1)?.stdout).not.toContain('PRECAST_PROJECT_PREVIEW:');
    expect(calls.complete).not.toHaveBeenCalled();
  });
  it('does not start the app or return a URL after an approval refusal', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    vi.stubEnv('PRECAST_PROJECT_PREVIEW_ENABLED', '1');
    calls.projectPreview.mockRejectedValue(new Error('preview approval refused'));
    await expect(scaffoldProject({ ...input, preview: 'srv.us' })).rejects.toThrow(
      'preview approval refused',
    );
    expect(calls.commands.some((c) => c.id === 'preview')).toBe(false);
    expect(calls.complete).toHaveBeenCalledWith(
      'run',
      'lease',
      'failed',
      'preview approval refused',
    );
  });
});
