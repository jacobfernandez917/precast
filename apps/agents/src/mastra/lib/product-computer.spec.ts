import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvedBrowserUrl,
  ProductComputerClient,
  productComputerInput,
  createProductComputerTools,
  terminalComputerRun,
} from './product-computer';
const token = vi.hoisted(() => vi.fn(async () => 'product-test-token'));
vi.mock('./agentbase-model', () => ({
  getAgentBaseToken: token,
  agentBaseIdentityKey: () => 'test-service',
}));
vi.mock('./request-context', () => ({
  attachAgentBaseProof: () => undefined,
  currentRayaScopeKey: () => {
    throw new Error('Signed Raya proof required');
  },
}));
const run = '00000000-0000-4000-8000-000000000001';
const lease = '00000000-0000-4000-8000-000000000002';
const action = '00000000-0000-4000-8000-000000000003';
const stateHash = `sha256:${'a'.repeat(64)}`;
beforeEach(() => vi.clearAllMocks());
describe('generated-agent Computer isolation', () => {
  it('does not expose Computer tools in the template or permit shell, typing or mail-send operations', () => {
    expect(createProductComputerTools('example-agent', null)).toEqual({});
    for (const operation of [
      'command_run',
      'type',
      'send',
      'financial_commitment',
      'permanent_delete',
    ])
      expect(productComputerInput.safeParse({ operation }).success).toBe(false);
  });
  it('accepts only declared exact HTTPS domains without embedded credentials or other ports', () => {
    expect(
      approvedBrowserUrl('https://mail.google.com/mail/u/0/', ['mail.google.com']).hostname,
    ).toBe('mail.google.com');
    for (const url of [
      'http://mail.google.com',
      'https://mail.google.com.evil.test',
      'https://google.com',
      'https://user:secret@mail.google.com',
      'https://mail.google.com:8443',
    ])
      expect(() => approvedBrowserUrl(url, ['mail.google.com'])).toThrow();
  });
  it('uses the product service identity and General profile without requesting builder paths, grants or secrets', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return Response.json(
        String(url).endsWith('/resolved')
          ? { run: { id: run }, lease: { id: lease } }
          : String(url).endsWith('/control/take')
            ? { session: { controlEpoch: 2 } }
            : { run: { state: 'RUNNING' } },
      );
    });
    const result = await new ProductComputerClient(
      'example-agent',
      'https://agentbase.test',
      fetcher,
    ).openSession('test-seed');
    expect(result).toEqual({ runId: run, leaseId: lease, epoch: 2 });
    expect(token).toHaveBeenCalledWith('example-agent');
    expect(token).not.toHaveBeenCalledWith('scaffold-builder');
    expect(calls[0]!.body).toEqual({
      requestedProfile: 'general',
      dataClassification: 'internal',
      idempotencyKey: 'precast-product:test-seed',
    });
  });
  it('waits on a proposed browser action instead of executing it', async () => {
    const fetcher = vi.fn(async () => Response.json({ action: { id: action, state: 'PROPOSED' } }));
    const persist = vi.fn();
    const result = await new ProductComputerClient(
      'example-agent',
      'https://agentbase.test',
      fetcher,
    ).step(
      { runId: run, leaseId: lease, epoch: 2 },
      { operation: 'open', url: 'https://mail.google.com' },
      'mail.google.com',
      undefined,
      persist,
    );
    expect(result.state).toBe('needs_person');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionId: action, executing: false }),
    );
  });
  it('does not replay an external effect after its execute response was lost', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/actions'))
        return Response.json({ action: { id: action, state: 'AUTHORIZED' } });
      if (String(url).endsWith('/execute')) throw new Error('Response lost');
      return Response.json({ action: { id: action, state: 'COMMITTED' } });
    });
    let saved: Parameters<ProductComputerClient['step']>[3];
    const persist = async (pending: NonNullable<typeof saved> | null) => {
      saved = pending ? structuredClone(pending) : undefined;
    };
    const client = new ProductComputerClient('example-agent', 'https://agentbase.test', fetcher);
    const session = { runId: run, leaseId: lease, epoch: 2 };
    const input = {
      operation: 'click' as const,
      ref: 'observed-element',
      intent: 'Open the selected message for reading',
    };
    await expect(
      client.step(session, input, 'mail.google.com', undefined, persist, { hash: stateHash }),
    ).rejects.toThrow('Response lost');
    expect(saved?.executing).toBe(true);
    expect(
      (await client.step(session, { operation: 'continue' }, 'mail.google.com', saved, persist))
        .state,
    ).toBe('outcome_pending');
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/execute'))).toHaveLength(1);
  });
  it('binds a reviewed click to the observed page and resumes its saved arguments after approval', async () => {
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    let approved = false;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      bodies.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (String(url).endsWith('/execute'))
        return Response.json({ action: { state: 'SUCCEEDED' }, output: { stateHash } });
      return Response.json({ action: { id: action, state: approved ? 'AUTHORIZED' : 'PROPOSED' } });
    });
    let saved: Parameters<ProductComputerClient['step']>[3];
    const persist = async (value: NonNullable<typeof saved> | null) => {
      saved = value ? structuredClone(value) : undefined;
    };
    const remember = vi.fn(async (_hash: string | null) => undefined);
    const client = new ProductComputerClient('example-agent', 'https://agentbase.test', fetcher);
    const session = { runId: run, leaseId: lease, epoch: 2 };
    expect(
      (
        await client.step(
          session,
          {
            operation: 'click',
            ref: 'observed-message',
            intent: 'Open the selected message to read',
          },
          'mail.google.com',
          undefined,
          persist,
          { hash: stateHash },
        )
      ).state,
    ).toBe('needs_person');
    expect(bodies[0]!.body).toMatchObject({
      retryClass: 'non_idempotent_write',
      target: { expectedStateHash: stateHash },
    });
    approved = true;
    await client.step(session, { operation: 'continue' }, 'mail.google.com', saved, persist, {
      remember,
    });
    expect(bodies.find((call) => call.url.endsWith('/commit'))!.body.stateHash).toBe(stateHash);
    expect(bodies.find((call) => call.url.endsWith('/execute'))!.body.arguments).toEqual({
      ref: 'observed-message',
    });
    expect(remember.mock.calls).toEqual([[null], [stateHash]]);
    expect(saved).toBeUndefined();
  });
  it('requires a current inspection and clear click intent before proposing a write', async () => {
    const fetcher = vi.fn();
    const client = new ProductComputerClient('example-agent', 'https://agentbase.test', fetcher);
    const session = { runId: run, leaseId: lease, epoch: 2 };
    await expect(client.step(session, { operation: 'scroll' }, 'mail.google.com')).rejects.toThrow(
      'Inspect',
    );
    await expect(
      client.step(
        session,
        { operation: 'click', ref: 'ref' },
        'mail.google.com',
        undefined,
        undefined,
        { hash: stateHash },
      ),
    ).rejects.toThrow('intended click');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('treats relative scroll as an external effect and preserves unfinished outcomes', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        String(url).endsWith('/execute')
          ? { action: { state: 'EXECUTING' }, output: null }
          : { action: { id: action, state: 'AUTHORIZED' } },
      ),
    );
    const save = vi.fn(async () => undefined);
    await new ProductComputerClient('example-agent', 'https://agentbase.test', fetcher).step(
      { runId: run, leaseId: lease, epoch: 2 },
      { operation: 'scroll' },
      'mail.google.com',
      undefined,
      save,
      { hash: stateHash },
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({
      retryClass: 'non_idempotent_write',
    });
    expect(save).not.toHaveBeenCalledWith(null);
  });
  it('refreshes its own lease before taking control after the owner resumes', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      Response.json(
        String(url).endsWith('/lease')
          ? { lease: { id: lease } }
          : String(url).endsWith('/control/take')
            ? { session: { controlEpoch: 3 } }
            : { run: { state: 'RUNNING' } },
      ),
    );
    expect(
      await new ProductComputerClient('example-agent', 'https://agentbase.test', fetcher).refresh({
        runId: run,
        leaseId: action,
        epoch: 2,
      }),
    ).toEqual({ runId: run, leaseId: lease, epoch: 3 });
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      `/computer-agent/runs/${run}`,
      `/computer-agent/runs/${run}/lease`,
      `/computer-agent/runs/${run}/control/take`,
    ]);
  });
  it('clears only terminal run receipts so a conversation can start another task', () => {
    for (const state of ['SUCCEEDED', 'FAILED', 'CANCELED', 'TIMED_OUT', 'BUDGET_EXCEEDED'])
      expect(terminalComputerRun(state)).toBe(true);
    for (const state of ['RUNNING', 'STARTING', 'QUEUED', 'WAITING_FOR_USER', 'PAUSED'])
      expect(terminalComputerRun(state)).toBe(false);
  });
});
