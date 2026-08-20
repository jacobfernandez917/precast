import { afterEach, describe, expect, it } from 'vitest';
import { assertAgentApiAuthConfigured } from './auth';

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
    expect(() => assertAgentApiAuthConfigured(env({ NODE_ENV: 'production', AGENT_API_TOKEN: '' }))).toThrow(
      /Refusing to start/,
    );
  });

  it('starts once a token is set', () => {
    expect(() =>
      assertAgentApiAuthConfigured(env({ NODE_ENV: 'production', AGENT_API_TOKEN: 'a'.repeat(64) })),
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
        assertAgentApiAuthConfigured(env({ NODE_ENV: 'production', ALLOW_UNAUTHENTICATED_AGENT_API: v }));
      if (shouldThrow) expect(call, `"${v}" must not disable the guard`).toThrow();
    }
  });
});
