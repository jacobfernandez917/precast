import { describe, expect, it, vi } from 'vitest';
import { AgentBaseComputerClient, argumentDigest } from './agentbase-computer';

vi.mock('./agentbase-model', () => ({ getAgentBaseToken: async () => 'test-token' }));
vi.mock('./request-context', () => ({ attachAgentBaseProof: () => undefined }));

describe('AgentBase Computer command binding', () => {
  it('matches AgentBase canonical argument hashing', () => {
    expect(argumentDigest({ b: 1, a: 2 })).toBe(argumentDigest({ a: 2, b: 1 }));
    expect(argumentDigest({ a: 2, omitted: undefined })).toBe(argumentDigest({ a: 2 }));
    expect(argumentDigest({ cwd: 'Projects/a' })).not.toBe(argumentDigest({ cwd: 'Projects/b' }));
  });

  it('binds the scaffold memory allowance to the proposed and executed command', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : {} });
      const body = path.endsWith('/actions')
        ? { action: { id: 'action-1' }, decision: { verdict: 'allow' } }
        : path.includes('/command?')
          ? { action: { state: 'SUCCEEDED' }, command: { exitCode: 0 }, output: { content: '' } }
          : {};
      return new Response(JSON.stringify(body));
    });
    const client = new AgentBaseComputerClient(
      'scaffold-builder',
      'https://agentbase.test',
      fetcher,
    );
    await client.runCommand(
      'run-1',
      'lease-1',
      2,
      {
        id: 'bootstrap',
        label: 'Bootstrap',
        executable: 'pnpm',
        argv: ['run', 'bootstrap'],
        cwd: 'Projects/example',
        timeoutMs: 1800000,
        memoryMiB: 3072,
      },
      'seed',
    );
    const execution = calls.find((call) => call.path.endsWith('/execute'))!.body
      .arguments as Record<string, unknown>;
    const proposal = calls.find((call) => call.path.endsWith('/actions'))!.body.target as Record<
      string,
      unknown
    >;
    expect(execution.memoryMiB).toBe(3072);
    expect(proposal.argumentDigest).toBe(argumentDigest(execution));
    expect(proposal.argumentDigest).not.toBe(argumentDigest({ ...execution, memoryMiB: 4096 }));
  });
});
