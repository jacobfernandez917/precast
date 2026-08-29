import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverMcpServers,
  resolveAgentMcpTools,
  resolveSubscribedServer,
} from './agentbase-mcp';
import { runWithRequestContext } from './request-context';

// `resolveAgentMcpTools` builds a real MCPClient, so the SDK is mocked to script
// connect outcomes per test. `vi.hoisted` because vi.mock is hoisted above the
// imports and would otherwise close over an uninitialised binding.
const mcpMocks = vi.hoisted(() => ({ listToolsWithErrors: vi.fn() }));
vi.mock('@mastra/mcp', () => ({
  MCPClient: class {
    constructor(opts: unknown) {
      // Expose the config so a test can invoke the per-server `fetch` the way
      // the real transport would.
      (globalThis as Record<string, unknown>).__lastMcpConfig = opts;
    }
    listToolsWithErrors = mcpMocks.listToolsWithErrors;
  },
}));

/**
 * MCPDISC-1 — runtime MCP discovery (AGT-007).
 *
 * The counterpart to `resolveAgentModel()`: an AgentBase-hosted agent learns
 * which MCP servers it may call instead of having them hardcoded in `.env`.
 *
 * The two behaviours worth pinning are the ones that are easy to get subtly
 * wrong and impossible to notice afterwards:
 *
 *  - **Inert off AgentBase.** Local dev, Standalone and External mode must be
 *    completely unaffected — no network call, no throw. If this regressed,
 *    every local `pnpm dev` would start failing on a URL that isn't there.
 *  - **Loud on failure when hosted.** A discovery error must throw, never
 *    return `[]`. An agent that silently loses its tools does not look broken —
 *    it answers confidently without them, which is the worst failure mode here.
 *  - **…except for a server nobody has connected an account to yet.** That one
 *    connect failure is expected rather than broken, and failing the boot on it
 *    crash-loops a container over a state only a human click can clear. Pinned
 *    below, because the fix is one `filter` away from silently swallowing every
 *    connect failure — the exact thing the bullet above forbids.
 */
const ORIGINAL_ENV = { ...process.env };

function hosted(base = 'https://api.agentbase.test/proxy/mcp') {
  process.env.AGENTBASE_HOSTED = '1';
  process.env.AGENTBASE_MCP_BASE_URL = base;
  // Credentials the token minter needs; the fetch mock makes them inert.
  process.env.AGENTBASE_TOKEN_URL = 'https://auth.agentbase.test/token';
  process.env.AGENTBASE_CLIENT_ID_EXAMPLE_AGENT = 'client-1';
  process.env.AGENTBASE_CLIENT_SECRET_EXAMPLE_AGENT = 'secret-1';
}

/** Answers the token endpoint, then delegates the discovery call to `onDiscover`. */
function mockFetch(onDiscover: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/token')) {
      return new Response(JSON.stringify({ access_token: 't0ken', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return onDiscover(url);
  });
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AGENTBASE_')) delete process.env[k];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('discoverMcpServers — off AgentBase', () => {
  it('is inert when AGENTBASE_HOSTED is unset, without any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(discoverMcpServers('example-agent')).resolves.toEqual([]);
    expect(fetchSpy, 'local dev must never call out').not.toHaveBeenCalled();
  });

  it('is inert when hosted but no MCP base URL was injected', async () => {
    process.env.AGENTBASE_HOSTED = '1';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(discoverMcpServers('example-agent')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('discoverMcpServers — hosted', () => {
  it('returns the subscribed servers', async () => {
    hosted();
    const servers = [
      {
        org: 'acme',
        slug: 'weather',
        title: 'Weather',
        scopes: [],
        url: '/proxy/mcp/acme/weather/mcp',
      },
    ];
    vi.stubGlobal(
      'fetch',
      mockFetch(
        () =>
          new Response(JSON.stringify({ mcpServers: servers }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await expect(discoverMcpServers('example-agent')).resolves.toEqual(servers);
  });

  it('queries the injected base URL, tolerating a trailing slash', async () => {
    hosted('https://api.agentbase.test/proxy/mcp/');
    let called = '';
    vi.stubGlobal(
      'fetch',
      mockFetch((url) => {
        called = url;
        return new Response(JSON.stringify({ mcpServers: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await discoverMcpServers('example-agent');
    expect(called).toBe('https://api.agentbase.test/proxy/mcp/subscriptions');
  });

  it('THROWS on a failed discovery rather than degrading to no tools', async () => {
    hosted();
    vi.stubGlobal(
      'fetch',
      mockFetch(() => new Response('nope', { status: 403 })),
    );

    // Returning [] here would be the silent-tool-loss failure this design
    // exists to prevent — the agent would answer confidently without them.
    await expect(discoverMcpServers('example-agent')).rejects.toThrow(/discovery failed/i);
  });

  it('treats a response with no mcpServers key as an empty entitlement', async () => {
    hosted();
    vi.stubGlobal(
      'fetch',
      mockFetch(
        () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await expect(discoverMcpServers('example-agent')).resolves.toEqual([]);
  });
});


/**
 * Connect-time failures, partitioned (AGT-007).
 *
 * Reproduced live on a hosted import: discovery succeeded, the subscribed
 * server's connect answered 401 `mcp_server_authorization_required`, and the
 * blanket throw killed the container — on a state that clears only when someone
 * clicks "Connect account", so the crash-loop could never resolve itself.
 *
 * These three cases fix the BOUNDARY, not just the bug: auth-pending is skipped,
 * everything else still fails the boot, and a healthy server's tools survive
 * alongside a skipped one. Widen the auth predicate and case 2 fails.
 */
describe('resolveAgentMcpTools — connect failures', () => {
  const SERVERS = [
    { org: '917ventures', slug: 'slack-mcp', title: 'Slack', scopes: [], url: '/proxy/mcp/917ventures/slack-mcp/mcp' },
  ];

  function hostedWithSubscription() {
    hosted();
    vi.stubGlobal(
      'fetch',
      mockFetch(
        () =>
          new Response(JSON.stringify({ mcpServers: SERVERS }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  }

  it('SKIPS an authorization-required server with a warning instead of failing the boot', async () => {
    hostedWithSubscription();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The exact shape a real proxy 401 surfaces as, captured from a live hosted
    // import — the marker is buried in a stringified body inside the message.
    mcpMocks.listToolsWithErrors.mockResolvedValue({
      tools: {},
      errors: {
        '917ventures__slack_mcp': new Error(
          'Failed to connect to MCP server 917ventures__slack_mcp: SdkHttpError: ' +
            'Error POSTing to endpoint: {"message":"mcp_server_authorization_required",' +
            '"error":"Unauthorized","statusCode":401}',
        ),
      },
    });

    await expect(resolveAgentMcpTools('example-agent')).resolves.toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no connected account'));
  });

  it('still THROWS on a non-auth connect failure (no silent tool loss)', async () => {
    hostedWithSubscription();
    mcpMocks.listToolsWithErrors.mockResolvedValue({
      tools: {},
      errors: { '917ventures__slack_mcp': new Error('ECONNREFUSED upstream is down') },
    });

    await expect(resolveAgentMcpTools('example-agent')).rejects.toThrow(
      /failed to connect .* incomplete toolset/is,
    );
  });

  it("keeps the healthy servers' tools while skipping an auth-pending one", async () => {
    hostedWithSubscription();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const weatherTool = { description: 'ok' };
    mcpMocks.listToolsWithErrors.mockResolvedValue({
      tools: { acme__weather_lookup: weatherTool },
      errors: { '917ventures__slack_mcp': new Error('401 Unauthorized') },
    });

    await expect(resolveAgentMcpTools('example-agent')).resolves.toEqual({
      acme__weather_lookup: weatherTool,
    });
  });
});


/**
 * OBO-1 end to end (AGT-012) and MCPADDR-1 (AGT-013).
 *
 * The contract the task defines as done: a subject on the inbound A2A call ends
 * up on the outbound MCP tool call. The MCPClient is built once at construction,
 * so this is really a test that the header is decided PER REQUEST — a static
 * `requestInit` would pass a happy-path assertion made at boot and then send an
 * empty subject for every real turn.
 */
describe('OBO — the subject reaches the MCP call', () => {
  const SERVERS = [
    { org: 'acme', slug: 'slack-mcp', title: 'Slack MCP', scopes: [], url: '/proxy/mcp/acme/slack-mcp/mcp' },
    { org: 'acme', slug: 'weather', title: 'Weather', scopes: [], url: '/proxy/mcp/acme/weather/mcp' },
  ];

  function hostedWith(servers = SERVERS) {
    hosted();
    vi.stubGlobal(
      'fetch',
      mockFetch(
        () =>
          new Response(JSON.stringify({ mcpServers: servers }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  }

  /**
   * Invoke the per-server `fetch` the way the real transport would, and read the
   * headers it handed to the global fetch — which is what actually goes on the
   * wire. (Asserting on anything the wrapper merely *returns* would prove
   * nothing about the request.)
   */
  async function headersForOneCall(subject?: string): Promise<Headers> {
    let captured: Headers | null = null;
    mcpMocks.listToolsWithErrors.mockImplementation(async () => {
      const cfg = (globalThis as Record<string, unknown>).__lastMcpConfig as {
        servers: Record<
          string,
          { fetch: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response> }
        >;
      };
      const server = Object.values(cfg.servers)[0];
      const spy = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
      const before = spy.mock.calls.length;
      await server.fetch('https://api.agentbase.test/proxy/mcp/acme/slack-mcp/mcp', {
        method: 'POST',
      });
      const call = spy.mock.calls[before] as [unknown, RequestInit];
      captured = new Headers(call?.[1]?.headers);
      return { tools: {}, errors: {} };
    });

    if (subject) {
      await runWithRequestContext({ onBehalfOf: subject }, () =>
        resolveAgentMcpTools('example-agent'),
      );
    } else {
      await resolveAgentMcpTools('example-agent');
    }
    if (!captured) throw new Error('the server fetch was never invoked');
    return captured;
  }

  it('forwards the subject from the inbound call', async () => {
    hostedWith();
    const h = await headersForOneCall('U03A8NAEH39');
    expect(h.get('x-agentbase-on-behalf-of')).toBe('U03A8NAEH39');
    expect(h.get('authorization'), 'the bearer must still be sent').toMatch(/^Bearer /);
  });

  it('sends no subject header when the call carries none', async () => {
    hostedWith();
    const h = await headersForOneCall();
    expect(h.get('x-agentbase-on-behalf-of')).toBeNull();
    expect(h.get('authorization')).toMatch(/^Bearer /);
  });
});

describe('resolveSubscribedServer', () => {
  const SERVERS = [
    { org: 'acme', slug: 'slack-mcp-2e688547', title: 'Slack MCP', scopes: [], url: '/proxy/mcp/acme/slack-mcp-2e688547/mcp' },
    { org: 'acme', slug: 'slack-admin', title: 'Slack Admin', scopes: [], url: '/proxy/mcp/acme/slack-admin/mcp' },
  ];
  function hostedWith(servers = SERVERS) {
    hosted();
    vi.stubGlobal(
      'fetch',
      mockFetch(
        () =>
          new Response(JSON.stringify({ mcpServers: servers }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  }

  it('resolves an absolute URL by exact slug — no env var involved', async () => {
    hostedWith();
    await expect(resolveSubscribedServer('example-agent', { slug: 'slack-mcp-2e688547' })).resolves.toBe(
      'https://api.agentbase.test/proxy/mcp/acme/slack-mcp-2e688547/mcp',
    );
  });

  it('names what WAS subscribed when nothing matches', async () => {
    hostedWith();
    await expect(
      resolveSubscribedServer('example-agent', { slug: 'nope' }),
    ).rejects.toThrow(/slack-mcp-2e688547/);
  });

  it('REFUSES to guess when several match', async () => {
    // Picking one of two plausible Slack servers would send a user's data to the
    // wrong place — much worse than an error someone reads once.
    hostedWith();
    await expect(
      resolveSubscribedServer('example-agent', { titleMatch: /slack/i }),
    ).rejects.toThrow(/refusing to guess/i);
  });

  it('errors clearly when MCP is not configured at all', async () => {
    delete process.env.AGENTBASE_MCP_BASE_URL;
    await expect(resolveSubscribedServer('example-agent', { slug: 'x' })).rejects.toThrow(
      /AGENTBASE_MCP_BASE_URL/,
    );
  });
});
