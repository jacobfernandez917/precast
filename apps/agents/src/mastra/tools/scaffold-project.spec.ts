import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; secrets?: unknown }>,
  complete: vi.fn(),
  createRun: vi.fn(),
  verify: vi.fn(),
  projectPreview: vi.fn(),
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
  },
}));
vi.mock('../lib/request-context', () => ({
  currentAgentBaseProof: () => ({ rayaUserDelegation: 'delegation', agentbaseChain: 'chain' }),
}));
vi.mock('../lib/service-verification', () => ({
  createServiceVerifier: () => ({ publicKey: 'public-key', verify: calls.verify }),
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
  it('refuses public exposure before creating a run when its separate gate or connected services are missing', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    vi.stubEnv('PRECAST_SERVICE_SETUP_ENABLED', '1');
    await expect(scaffoldProject({ ...input, preview: 'srv.us' })).rejects.toThrow(/preview gate/);
    vi.stubEnv('PRECAST_PROJECT_PREVIEW_ENABLED', '1');
    await expect(
      scaffoldProject({ ...input, services: 'deferred', preview: 'srv.us' }),
    ).rejects.toThrow(/preview gate/);
    expect(calls.createRun).not.toHaveBeenCalled();
  });
  it('starts the app only after exact authorization, hands it to the owner, and returns a curated verified URL', async () => {
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
    const result = await scaffoldProject({ ...input, preview: 'srv.us' });
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
