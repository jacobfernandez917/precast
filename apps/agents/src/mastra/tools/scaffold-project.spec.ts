import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; secrets?: unknown }>,
  complete: vi.fn(),
  createRun: vi.fn(),
  verify: vi.fn(),
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
        stdout: command.id === 'services' ? 'encrypted-receipt-private-to-tool' : '',
        stderr: '',
      };
    }
    complete = calls.complete;
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
