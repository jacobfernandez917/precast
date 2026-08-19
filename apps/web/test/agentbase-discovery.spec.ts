import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverAgentRoutes,
  resolveAgentUrl,
  resetDiscoveryCacheForTests,
  overrideEnvVarName,
} from '../app/lib/agentbase-discovery';

/**
 * AGENTDISC-1 — runtime agent-route discovery (WEB-011).
 *
 * Replaces a hand-maintained `AGENTBASE_AGENT_URL_<AGENT_ID>` per agent. The
 * mapping is read from each agent's own A2A card, because Mastra names the card
 * after the agent ID and AgentBase's synthesizer preserves `name`.
 *
 * These cases target the FAILURE boundary rather than the happy path. The way
 * this feature breaks in production is not "discovery returns nothing" — it is
 * "discovery quietly falls back to a guessed URL", which 404s while looking
 * perfectly well-formed. That is the exact bug it was built to remove, so the
 * no-fallback rule is pinned hardest.
 */
const ORIGINAL_ENV = { ...process.env };
const BASE = 'https://api.agentbase.test';

function configured() {
  process.env.AGENTBASE_URL = BASE;
  process.env.AGENTBASE_TOKEN_URL = 'https://auth.agentbase.test/token';
  process.env.AGENTBASE_CLIENT_ID = 'cid';
  process.env.AGENTBASE_CLIENT_SECRET = 'secret';
}

function subscriptionsPayload(items: unknown[]) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify({ items }) }] },
  };
}

const AGENT_ROW = {
  targetType: 'agent',
  status: 'ACTIVE',
  targetSlug: 'founder-advisor-479c1de1',
  providerTenantSlug: 'acme',
};

/**
 * Routes the three call shapes discovery makes: token mint, the native MCP
 * tool, and each agent card. `cards` maps slug → the card's `name`.
 */
function mockAgentBase(opts: {
  items?: unknown[];
  cards?: Record<string, string>;
  toolStatus?: number;
  cardStatus?: number;
}) {
  const { items = [AGENT_ROW], cards = { 'founder-advisor-479c1de1': 'advisor-agent' } } = opts;
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/mcp')) {
      if (opts.toolStatus && opts.toolStatus !== 200) {
        return new Response('nope', { status: opts.toolStatus });
      }
      return new Response(JSON.stringify(subscriptionsPayload(items)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/.well-known/agent.json')) {
      if (opts.cardStatus && opts.cardStatus !== 200) {
        return new Response('nope', { status: opts.cardStatus });
      }
      const slug = url.split('/proxy/a2a/')[1]?.split('/')[1] ?? '';
      const name = cards[slug];
      if (!name) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ name }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AGENTBASE_')) delete process.env[k];
  }
  resetDiscoveryCacheForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveAgentUrl — the mapping', () => {
  it('maps a Mastra id to its slug via the agent card, not the listing name', async () => {
    configured();
    mockAgentBase({});
    await expect(resolveAgentUrl('advisor-agent')).resolves.toEqual({
      ok: true,
      url: `${BASE}/proxy/a2a/acme/founder-advisor-479c1de1`,
    });
  });

  it('honours an explicit override without any network call', async () => {
    configured();
    const spy = mockAgentBase({});
    process.env[overrideEnvVarName('advisor-agent')] = 'https://pinned.test/a2a';
    await expect(resolveAgentUrl('advisor-agent')).resolves.toEqual({
      ok: true,
      url: 'https://pinned.test/a2a',
    });
    expect(spy, 'an override must short-circuit discovery entirely').not.toHaveBeenCalled();
  });

  it('ignores non-agent and revoked subscriptions', async () => {
    configured();
    mockAgentBase({
      items: [
        { ...AGENT_ROW, targetType: 'mcp_server' },
        { ...AGENT_ROW, status: 'REVOKED' },
      ],
      cards: { 'founder-advisor-479c1de1': 'advisor-agent' },
    });
    const result = await resolveAgentUrl('advisor-agent');
    expect(result.ok).toBe(false);
  });
});

describe('resolveAgentUrl — failure never degrades to a guess', () => {
  it('errors when AGENTBASE_URL is unset instead of guessing a URL', async () => {
    process.env.AGENTBASE_TOKEN_URL = 'https://auth.agentbase.test/token';
    process.env.AGENTBASE_CLIENT_ID = 'cid';
    process.env.AGENTBASE_CLIENT_SECRET = 'secret';
    mockAgentBase({});
    const result = await resolveAgentUrl('advisor-agent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/AGENTBASE_URL/);
  });

  it('surfaces a discovery failure rather than returning a well-formed 404 URL', async () => {
    configured();
    mockAgentBase({ toolStatus: 500 });
    const result = await resolveAgentUrl('advisor-agent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/list_subscriptions/);
      expect(result.error, 'must not hand back a URL').not.toMatch(/proxy\/a2a/);
    }
  });

  it('names what WAS discovered when the id is unknown', async () => {
    configured();
    mockAgentBase({});
    const result = await resolveAgentUrl('finance-ops-agent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/advisor-agent/);
      expect(result.error).toMatch(/AGENTBASE_AGENT_URL_FINANCE_OPS_AGENT/);
    }
  });

  it('refuses to choose when two subscribed agents claim one Mastra id', async () => {
    configured();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAgentBase({
      items: [AGENT_ROW, { ...AGENT_ROW, targetSlug: 'other-advisor-aaaa', providerTenantSlug: 'globex' }],
      cards: {
        'founder-advisor-479c1de1': 'advisor-agent',
        'other-advisor-aaaa': 'advisor-agent',
      },
    });
    const result = await resolveAgentUrl('advisor-agent');
    expect(result.ok, 'silently picking one would route traffic to an arbitrary agent').toBe(false);
  });
});

describe('discoverAgentRoutes — caching', () => {
  it('caches a successful discovery', async () => {
    configured();
    const spy = mockAgentBase({});
    await discoverAgentRoutes();
    const callsAfterFirst = spy.mock.calls.length;
    await discoverAgentRoutes();
    expect(spy.mock.calls.length, 'a cached hit must make no further calls').toBe(callsAfterFirst);
  });

  it('does NOT cache a failure — a transient blip must not stick for a full TTL', async () => {
    configured();
    mockAgentBase({ toolStatus: 500 });
    await discoverAgentRoutes();

    // Recovery must produce the REAL route. Asserting only `ok: true` would
    // pass against a cached empty map, which is the failure being guarded
    // against — the app would keep answering "no such agent" for a full TTL.
    mockAgentBase({});
    const second = await discoverAgentRoutes();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.routes.get('advisor-agent')).toEqual({
        org: 'acme',
        slug: 'founder-advisor-479c1de1',
        url: `${BASE}/proxy/a2a/acme/founder-advisor-479c1de1`,
      });
    }
  });

  it('shares one in-flight discovery between concurrent callers', async () => {
    configured();
    const spy = mockAgentBase({});
    await Promise.all([discoverAgentRoutes(), discoverAgentRoutes(), discoverAgentRoutes()]);
    const mcpCalls = spy.mock.calls.filter(([u]) => String(u).endsWith('/mcp')).length;
    expect(mcpCalls, 'three concurrent callers must trigger one discovery').toBe(1);
  });
});
