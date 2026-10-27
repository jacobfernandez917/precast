import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/agentbase-auth', () => ({
  getAgentBaseAccessToken: vi.fn(),
}));

import { callAgent } from '../app/lib/a2a-client';
import { getAgentBaseAccessToken } from '../app/lib/agentbase-auth';
import { resetDiscoveryCacheForTests } from '../app/lib/agentbase-discovery';

const mockedGetToken = vi.mocked(getAgentBaseAccessToken);

const AGENT_URL_VAR = 'AGENTBASE_AGENT_URL_EXAMPLE_AGENT';
const ENV_KEYS = [
  'PRECAST_LOCAL_AGENTS',
  'ENABLE_AGENTBASE',
  AGENT_URL_VAR,
  'MASTRA_INTERNAL_URL',
  'AGENT_API_TOKEN',
] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  mockedGetToken.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.unstubAllGlobals();
});

const A2A_MESSAGE_RESPONSE = {
  jsonrpc: '2.0',
  id: 'x',
  result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'hello back' }] },
};

describe('callAgent — proxy mode (AgentBase)', () => {
  beforeEach(() => {
    // Discovery caches its route map in module scope — without this, a map
    // built in one case leaks into the next and the guard-rail cases pass for
    // the wrong reason.
    resetDiscoveryCacheForTests();
    process.env.PRECAST_LOCAL_AGENTS = '0';
    delete process.env.ENABLE_AGENTBASE;
    process.env[AGENT_URL_VAR] = 'https://agentbase.acme.dev/proxy/a2a/acme/example-agent-a1b2c3d4';
  });

  // AGENTDISC-1 changed this contract deliberately. An unset per-agent var is no
  // longer an error — it is the NORMAL case, and the URL is discovered. What
  // must still hold is the guard rail underneath it: with nothing configured to
  // discover FROM, the call fails with an actionable message and never invents a
  // URL. A guessed `/proxy/a2a/<org>/<id>` is the well-formed 404 this feature
  // exists to eliminate.
  it('guard-rails when neither an override nor discovery config is set', async () => {
    delete process.env[AGENT_URL_VAR];
    delete process.env.AGENTBASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const reply = await callAgent('example-agent', 'hi');

    expect(reply.ok).toBe(false);
    expect(reply.via).toBe('agentbase');
    // The setup detail (which variable is missing) goes to the log; the person
    // chatting gets a sentence.
    expect(reply.error).toBe('This page cannot reach your agent on AgentBase yet.');
    expect(reply.error, 'must not hand back an invented URL').not.toMatch(/proxy\/a2a/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('derives the env var name from the agent id (uppercase, non-alphanumeric -> _)', async () => {
    process.env.AGENTBASE_AGENT_URL_SLACK_DAILY_DIGEST =
      'https://agentbase.acme.dev/proxy/a2a/acme/slack-daily-digest-73a6577a';
    mockedGetToken.mockResolvedValue({ ok: true, accessToken: 'jwt' });
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await callAgent('slack-daily-digest', 'hi');

    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://agentbase.acme.dev/proxy/a2a/acme/slack-daily-digest-73a6577a');
    delete process.env.AGENTBASE_AGENT_URL_SLACK_DAILY_DIGEST;
  });

  it('surfaces a token-mint failure without calling fetch', async () => {
    mockedGetToken.mockResolvedValue({ ok: false, error: 'Application credentials not set' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const reply = await callAgent('example-agent', 'hi');

    expect(reply.ok).toBe(false);
    expect(reply.error).toBe('This app could not sign in to AgentBase.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the plain A2A message/send envelope (no slug/skill wrapper) with the minted bearer', async () => {
    mockedGetToken.mockResolvedValue({ ok: true, accessToken: 'minted-jwt' });
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const reply = await callAgent('example-agent', 'hi there', {
      threadId: 'res-1::conv-1',
      resourceId: 'res-1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://agentbase.acme.dev/proxy/a2a/acme/example-agent-a1b2c3d4');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer minted-jwt');

    const body = JSON.parse(String(init.body));
    // No agent_slug/skill_id wrapper — the URL already encodes the target.
    expect(body.agent_slug).toBeUndefined();
    expect(body.skill_id).toBeUndefined();
    expect(body.method).toBe('message/send');
    expect(body.params.message.parts[0].text).toBe('hi there');
    expect(body.params.message.contextId).toBe('res-1::conv-1');
    // Load-bearing: Mastra falls back to the agent id when this is absent,
    // which would put every user in one shared memory bucket.
    expect(body.params.message.metadata.resourceId).toBe('res-1');

    expect(reply).toMatchObject({ ok: true, via: 'agentbase', text: 'hello back' });
  });
});

describe('callAgent — local agents (PRECAST_LOCAL_AGENTS=1)', () => {
  it('sends a message/send A2A envelope straight to Mastra, bypassing AgentBase entirely', async () => {
    process.env.PRECAST_LOCAL_AGENTS = '1';
    process.env.MASTRA_INTERNAL_URL = 'http://localhost:4111';
    process.env.AGENT_API_TOKEN = 'mastra-token';
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const reply = await callAgent('example-agent', 'hi');

    expect(mockedGetToken).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:4111/api/a2a/example-agent');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mastra-token');
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe('message/send');
    expect(reply).toMatchObject({ ok: true, via: 'direct', text: 'hello back' });
  });
});

/** WEB-015: the client asks for cards on every call and hands back what the agent attached. */
describe('callAgent — A2UI (cards)', () => {
  beforeEach(() => {
    process.env.PRECAST_LOCAL_AGENTS = '1';
    process.env.MASTRA_INTERNAL_URL = 'http://mastra.test';
  });

  const a2ui = [
    { version: 'v0.9.1', createSurface: { surfaceId: 'card-1', catalogId: 'raya.blocks.v1' } },
    {
      version: 'v0.9.1',
      updateComponents: {
        surfaceId: 'card-1',
        components: [{ id: 'root', component: 'Stack', children: [] }],
      },
    },
  ];
  const TASK_WITH_CARD = {
    jsonrpc: '2.0',
    id: 'x',
    result: {
      kind: 'task',
      id: 't1',
      status: { state: 'completed' },
      artifacts: [
        {
          artifactId: 't1:response',
          parts: [
            { kind: 'text', text: 'Done.' },
            { kind: 'data', metadata: { mimeType: 'application/a2ui+json' }, data: a2ui },
          ],
        },
      ],
    },
  };

  it('declares the catalog it renders and requests the extension, on every call', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await callAgent('example-agent', 'hi', { threadId: 't', resourceId: 'r' });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-A2A-Extensions']).toBe(
      'https://a2ui.org/a2a-extension/a2ui/v0.9.1',
    );
    const body = JSON.parse(String(init.body));
    expect(body.params.message.metadata).toEqual({
      resourceId: 'r',
      a2uiClientCapabilities: { 'v0.9.1': { supportedCatalogIds: ['raya.blocks.v1'] } },
    });
  });

  it('returns the A2UI messages beside the text, in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(TASK_WITH_CARD), { status: 200 })),
    );
    const reply = await callAgent('example-agent', 'deploy status?');
    expect(reply.ok).toBe(true);
    expect(reply.text).toBe('Done.');
    expect(reply.a2ui).toEqual(a2ui);
  });

  it('returns no cards for a text-only reply or an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 })),
    );
    expect((await callAgent('example-agent', 'hi')).a2ui).toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 'x', error: { message: 'boom' } }), {
            status: 200,
          }),
      ),
    );
    const failed = await callAgent('example-agent', 'hi');
    expect(failed.ok).toBe(false);
    expect(failed.a2ui).toEqual([]);
  });
});

/** WEB-017: the pre-v0.10.0 switch still works for one release, and the new one wins. */
describe('callAgent — the retired ENABLE_AGENTBASE spelling', () => {
  it('ENABLE_AGENTBASE=0 still means local when PRECAST_LOCAL_AGENTS is unset', async () => {
    delete process.env.PRECAST_LOCAL_AGENTS;
    process.env.ENABLE_AGENTBASE = '0';
    process.env.MASTRA_INTERNAL_URL = 'http://mastra.test';
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const reply = await callAgent('example-agent', 'hi');
    expect(reply.via).toBe('direct');
    expect(String((fetchSpy.mock.calls[0] as unknown as [string])[0])).toBe(
      'http://mastra.test/api/a2a/example-agent',
    );
  });

  it('PRECAST_LOCAL_AGENTS wins over the retired spelling', async () => {
    process.env.PRECAST_LOCAL_AGENTS = '0';
    process.env.ENABLE_AGENTBASE = '0';
    delete process.env.AGENTBASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reply = await callAgent('example-agent', 'hi');
    expect(reply.via).toBe('agentbase');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * WEB-018: every way the call can go wrong comes back as a reply with the right
 * status and a message written here, never an exception and never upstream text.
 * Legitimate waiting states are answers, not errors.
 */
describe('callAgent — errors, statuses and Task states', () => {
  const SECRET = 'hunter2-upstream-secret';

  beforeEach(() => {
    process.env.PRECAST_LOCAL_AGENTS = '1';
    process.env.MASTRA_INTERNAL_URL = 'http://mastra.test';
    process.env.AGENT_API_TOKEN = 'bearer-never-shown';
  });

  const answer = (body: unknown, status = 200, contentType = 'application/json') =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'content-type': contentType },
          }),
      ),
    );
  const task = (state: string, statusText?: string) => ({
    jsonrpc: '2.0',
    id: 'x',
    result: {
      kind: 'task',
      id: 't1',
      status: {
        state,
        ...(statusText
          ? {
              message: {
                kind: 'message',
                role: 'agent',
                parts: [{ kind: 'text', text: statusText }],
              },
            }
          : {}),
      },
    },
  });
  const leaks = (reply: { error?: string }) => {
    expect(reply.error ?? '').not.toContain(SECRET);
    expect(reply.error ?? '').not.toContain('bearer-never-shown');
  };

  it.each([401, 403, 404, 429, 500, 503])(
    'an HTTP %i from the agent endpoint keeps its status',
    async (status) => {
      answer({ jsonrpc: '2.0', id: 'x', error: { code: -32000, message: SECRET } }, status);
      const reply = await callAgent('example-agent', 'hi');
      expect(reply).toMatchObject({ ok: false, status, text: null, a2ui: [] });
      expect(reply.error).toMatch(new RegExp(`HTTP ${status}`));
      leaks(reply);
    },
  );

  it("a gateway's HTML error page keeps its status and is not parsed as JSON", async () => {
    answer(`<html><body>Bad gateway ${SECRET}</body></html>`, 502, 'text/html');
    const reply = await callAgent('example-agent', 'hi');
    expect(reply).toMatchObject({ ok: false, status: 502 });
    leaks(reply);
  });

  it('a 200 that is not JSON, or not a JSON-RPC response, is a 502', async () => {
    answer('<html>ok</html>', 200, 'text/html');
    expect(await callAgent('example-agent', 'hi')).toMatchObject({ ok: false, status: 502 });

    for (const body of [
      { hello: 'world' },
      [1, 2],
      { jsonrpc: '2.0', id: 'x', result: { kind: 'message', parts: [] }, error: { code: 1 } },
      { jsonrpc: '2.0', id: 'x', result: { kind: 'something-else' } },
      { jsonrpc: '2.0', id: 'x', result: { kind: 'task', id: 't1', status: {} } },
    ]) {
      answer(body);
      const reply = await callAgent('example-agent', 'hi');
      expect(reply, JSON.stringify(body)).toMatchObject({ ok: false, status: 502 });
    }
  });

  it('a network failure is a 502 and a timeout a 504, neither thrown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await callAgent('example-agent', 'hi')).toMatchObject({
      ok: false,
      status: 502,
      error: 'Could not reach the agent.',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }),
    );
    expect(await callAgent('example-agent', 'hi')).toMatchObject({ ok: false, status: 504 });
  });

  it('a JSON-RPC error names its code, not its message', async () => {
    answer({ jsonrpc: '2.0', id: 'x', error: { code: -32603, message: `db password=${SECRET}` } });
    const reply = await callAgent('example-agent', 'hi');
    expect(reply).toMatchObject({ ok: false, status: 502 });
    expect(reply.error).toBe('The agent returned an error (JSON-RPC -32603).');
    leaks(reply);
  });

  it.each([
    ['failed', 'failed'],
    ['canceled', 'canceled'],
    ['cancelled', 'canceled'],
    ['rejected', 'rejected'],
    ['TASK_STATE_FAILED', 'failed'],
    ['unknown', 'unknown'],
  ])('a Task in state %s is a failure (%s), without its upstream text', async (state, as) => {
    answer(task(state, `stack trace with ${SECRET}`));
    const reply = await callAgent('example-agent', 'hi');
    expect(reply).toMatchObject({ ok: false, status: 502, taskState: as, text: null });
    leaks(reply);
  });

  it.each([
    ['input-required', 'Which environment?'],
    ['auth-required', 'Connect your calendar first.'],
    ['working', undefined],
    ['submitted', undefined],
    ['TASK_STATE_INPUT_REQUIRED', 'Which environment?'],
  ])('a Task in state %s is an answer, not an error', async (state, text) => {
    answer(task(state, text));
    const reply = await callAgent('example-agent', 'hi');
    expect(reply.ok).toBe(true);
    expect(reply.status).toBe(200);
    expect(reply.taskState).toBe(state.startsWith('TASK_STATE_') ? 'input-required' : state);
    expect(reply.text).toBe(text ?? null);
  });

  it('a completed Task and a Message still answer with their text', async () => {
    answer(task('completed', 'All done.'));
    expect(await callAgent('example-agent', 'hi')).toMatchObject({
      ok: true,
      status: 200,
      taskState: 'completed',
      text: 'All done.',
    });
    answer(A2A_MESSAGE_RESPONSE);
    expect(await callAgent('example-agent', 'hi')).toMatchObject({
      ok: true,
      status: 200,
      text: 'hello back',
    });
  });
});

/** WEB-027: the signed-in person travels as X-AgentBase-On-Behalf-Of on both transports. */
describe('callAgent — on behalf of the signed-in person', () => {
  const headersOf = (spy: ReturnType<typeof vi.fn>) =>
    (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
  const ok = () =>
    vi.fn(async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }));

  it('sends the subject to the local agents app, and nothing when there is none', async () => {
    process.env.PRECAST_LOCAL_AGENTS = '1';
    process.env.MASTRA_INTERNAL_URL = 'http://mastra.test';
    const spy = ok();
    vi.stubGlobal('fetch', spy);
    await callAgent('example-agent', 'hi', { onBehalfOf: 'u-123' });
    expect(headersOf(spy)['X-AgentBase-On-Behalf-Of']).toBe('u-123');

    const bare = ok();
    vi.stubGlobal('fetch', bare);
    await callAgent('example-agent', 'hi');
    expect(headersOf(bare)).not.toHaveProperty('X-AgentBase-On-Behalf-Of');
  });

  it('sends the subject through the AgentBase proxy too', async () => {
    resetDiscoveryCacheForTests();
    process.env.PRECAST_LOCAL_AGENTS = '0';
    process.env[AGENT_URL_VAR] = 'https://agentbase.acme.dev/proxy/a2a/acme/example-agent-a1b2c3d4';
    mockedGetToken.mockResolvedValue({ ok: true, accessToken: 'jwt' });
    const spy = ok();
    vi.stubGlobal('fetch', spy);
    await callAgent('example-agent', 'hi', { onBehalfOf: 'u-123' });
    expect(headersOf(spy)['X-AgentBase-On-Behalf-Of']).toBe('u-123');
    expect(headersOf(spy).Authorization).toBe('Bearer jwt');
  });
});
