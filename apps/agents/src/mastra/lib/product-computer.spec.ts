import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvedBrowserUrl,
  ProductComputerClient,
  productComputerInput,
  createProductComputerTools,
} from './product-computer';
const token = vi.hoisted(() => vi.fn(async () => 'product-test-token'));
vi.mock('./agentbase-model', () => ({ getAgentBaseToken: token }));
vi.mock('./request-context', () => ({
  attachAgentBaseProof: () => undefined,
  currentRayaScopeKey: () => {
    throw new Error('Signed Raya proof required');
  },
}));
const run = '00000000-0000-4000-8000-000000000001';
const lease = '00000000-0000-4000-8000-000000000002';
const action = '00000000-0000-4000-8000-000000000003';
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
    const input = { operation: 'click' as const, ref: 'observed-element' };
    await expect(
      client.step(session, input, 'mail.google.com', undefined, persist),
    ).rejects.toThrow('Response lost');
    expect(saved?.executing).toBe(true);
    expect((await client.step(session, input, 'mail.google.com', saved, persist)).state).toBe(
      'outcome_pending',
    );
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/execute'))).toHaveLength(1);
  });
});
