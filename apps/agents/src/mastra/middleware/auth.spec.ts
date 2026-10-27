import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { assertAgentApiAuthConfigured, createAuthMiddleware, isProtectedPath } from './auth';

/**
 * The production auth guard (AGT-010).
 *
 * An unset `AGENT_API_TOKEN` leaves `/api/a2a/*` and `/api/agents/*` open. That
 * is the right default locally and wrong in production, where nothing else
 * notices: the container is healthy and the agents answer.
 *
 * The case that motivates the FRESH-SCAFFOLD test below is one this guard got
 * wrong on arrival. `.env.example` ships `AGENT_API_TOKEN=` — an EMPTY STRING,
 * not an absent var — and the runtime images bake `NODE_ENV=production`. So the
 * guard fired on a brand-new project and `pnpm poc`, the first thing anyone
 * runs, failed to start the agents container. Bootstrap now mints a token; this
 * pins both halves of that contract.
 */
const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;

describe('assertAgentApiAuthConfigured', () => {
  it('is inert outside production, however the token looks', () => {
    expect(() => assertAgentApiAuthConfigured(env({ NODE_ENV: 'development' }))).not.toThrow();
    expect(() => assertAgentApiAuthConfigured(env({}))).not.toThrow();
    expect(() => assertAgentApiAuthConfigured(env({ NODE_ENV: 'test' }))).not.toThrow();
  });

  it('refuses to start in production with no token', () => {
    expect(() => assertAgentApiAuthConfigured(env({ NODE_ENV: 'production' }))).toThrow(
      /Refusing to start/,
    );
  });

  it('treats an EMPTY token as absent — this is the fresh-scaffold case', () => {
    // `.env.example` ships `AGENT_API_TOKEN=`, which reaches the process as ''.
    // If this ever passed, an image baking NODE_ENV=production would serve an
    // open agent API while looking perfectly configured.
    expect(() =>
      assertAgentApiAuthConfigured(env({ NODE_ENV: 'production', AGENT_API_TOKEN: '' })),
    ).toThrow(/Refusing to start/);
  });

  it('starts once a token is set', () => {
    expect(() =>
      assertAgentApiAuthConfigured(
        env({ NODE_ENV: 'production', AGENT_API_TOKEN: 'a'.repeat(64) }),
      ),
    ).not.toThrow();
  });

  it('allows an explicit, deliberate opt-out', () => {
    expect(() =>
      assertAgentApiAuthConfigured(
        env({ NODE_ENV: 'production', ALLOW_UNAUTHENTICATED_AGENT_API: '1' }),
      ),
    ).not.toThrow();
  });

  it('does not accept a truthy-looking opt-out other than exactly "1"', () => {
    // A loose check would let ALLOW_UNAUTHENTICATED_AGENT_API=false disable the
    // guard, which is the opposite of what the operator wrote.
    for (const v of ['0', 'false', 'no', 'true']) {
      const shouldThrow = v !== '1';
      const call = () =>
        assertAgentApiAuthConfigured(
          env({ NODE_ENV: 'production', ALLOW_UNAUTHENTICATED_AGENT_API: v }),
        );
      if (shouldThrow) expect(call, `"${v}" must not disable the guard`).toThrow();
    }
  });
});

/**
 * AGT-026: the bearer guards every Mastra route under /api, not only A2A. Found
 * on a fresh scaffold: `POST /api/tools/<tool>/execute` ran a tool, and the
 * memory threads, workflows and traces routes answered, all with no bearer.
 */
describe('createAuthMiddleware — what the bearer protects', () => {
  const TOKEN = 'a'.repeat(64);
  const call = async (path: string, authorization?: string) => {
    let reached = false;
    let status = 200;
    const c = {
      req: {
        path,
        header: (n: string) => (n.toLowerCase() === 'authorization' ? authorization : undefined),
      },
      json: (_b: Record<string, unknown>, s: number) => {
        status = s;
        return new Response(null, { status: s });
      },
      res: new Response('{}'),
    };
    const out = await createAuthMiddleware()(c, async () => {
      reached = true;
    });
    if (out) status = out.status;
    return { reached, status };
  };

  beforeEach(() => {
    process.env.AGENT_API_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.AGENT_API_TOKEN;
  });

  it.each([
    '/api/tools/exampleTool/execute',
    '/api/tools',
    '/api/memory/threads',
    '/api/memory/threads/t1/messages',
    '/api/workflows',
    '/api/observability/traces',
    '/api/a2a/example-agent',
    '/api/agents/example-agent/generate',
    '/api',
  ])('%s needs the bearer', async (path) => {
    expect(await call(path)).toEqual({ reached: false, status: 401 });
    expect(await call(path, 'Bearer wrong')).toEqual({ reached: false, status: 401 });
    expect(await call(path, `Bearer ${TOKEN}`)).toEqual({ reached: true, status: 200 });
  });

  it('leaves the agent card, the root page and /health open', async () => {
    for (const path of ['/api/.well-known/example-agent/agent-card.json', '/', '/health']) {
      expect(await call(path), path).toEqual({ reached: true, status: 200 });
    }
  });

  it('a path that only looks like the card is still protected', () => {
    expect(isProtectedPath('/api/tools/agent-card.json')).toBe(true);
    expect(isProtectedPath('/api/.well-known/x/agent-card.json')).toBe(false);
  });

  it('with no token set (local development) nothing is refused', async () => {
    delete process.env.AGENT_API_TOKEN;
    expect(await call('/api/tools/exampleTool/execute')).toEqual({ reached: true, status: 200 });
  });
});
