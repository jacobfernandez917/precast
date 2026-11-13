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
  it('binds exact bounded PRD contents and refuses a path outside the new project input', async () => {
    const captured: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      captured.push({ path, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(
        JSON.stringify(
          path.endsWith('/actions')
            ? { action: { id: 'input-action' }, decision: { verdict: 'allow' } }
            : { action: { state: 'SUCCEEDED' } },
        ),
      );
    });
    const client = new AgentBaseComputerClient(
      'scaffold-builder',
      'https://agentbase.test',
      fetcher,
    );
    await expect(
      client.writeProjectInput('run', 'lease', 2, 'Projects/../.env', 'secret', 'seed'),
    ).rejects.toThrow(/Invalid bounded/);
    expect(fetcher).not.toHaveBeenCalled();
    await client.writeProjectInput(
      'run',
      'lease',
      2,
      'Projects/action-desk/.precast/prd-build.json',
      '{"source":"exact"}',
      'seed',
    );
    const proposed = captured.find((c) => c.path.endsWith('/actions'))!.body.target as Record<
      string,
      unknown
    >;
    const executed = captured.find((c) => c.path.endsWith('/execute'))!.body.arguments as Record<
      string,
      unknown
    >;
    expect(executed).toEqual({
      path: 'Projects/action-desk/.precast/prd-build.json',
      content: '{"source":"exact"}',
      profile: 'developer',
    });
    expect(proposed.argumentDigest).toBe(argumentDigest(executed));
  });
});
