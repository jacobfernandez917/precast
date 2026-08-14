import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgentBaseLlmToken,
  isAgentBaseLlmConfigured,
  resetAgentBaseLlmTokenCacheForTests,
  resolveAgentModel,
} from './agentbase-model';

const ENV_KEYS = [
  'AGENTBASE_HOSTED',
  'AGENTBASE_LLM_BASE_URL',
  'AGENTBASE_LLM_TOKEN_URL',
  'AGENTBASE_LLM_CLIENT_ID_EXAMPLE_AGENT',
  'AGENTBASE_LLM_CLIENT_SECRET_EXAMPLE_AGENT',
  'AGENTBASE_LLM_MODEL_EXAMPLE_AGENT',
] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  resetAgentBaseLlmTokenCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setConfig() {
  process.env.AGENTBASE_LLM_BASE_URL = 'https://agentbase.example.com/llm/v1';
  process.env.AGENTBASE_LLM_TOKEN_URL =
    'https://keycloak.example.com/realms/agentbase/protocol/openid-connect/token';
  process.env.AGENTBASE_LLM_CLIENT_ID_EXAMPLE_AGENT = 'svc-client-id';
  process.env.AGENTBASE_LLM_CLIENT_SECRET_EXAMPLE_AGENT = 'svc-client-secret';
  process.env.AGENTBASE_LLM_MODEL_EXAMPLE_AGENT = 'google/gemini-2.5-flash';
}

describe('resolveAgentModel', () => {
  it('falls back to the plain router string when not AgentBase-hosted and unconfigured (local dev)', () => {
    delete process.env.AGENTBASE_HOSTED;
    delete process.env.AGENTBASE_LLM_BASE_URL;
    delete process.env.AGENTBASE_LLM_MODEL_EXAMPLE_AGENT;
    expect(resolveAgentModel('example-agent', 'google/gemini-2.5-flash')).toBe(
      'google/gemini-2.5-flash',
    );
  });

  it('falls back (local) when only the base URL is set but this agent has no model chosen', () => {
    delete process.env.AGENTBASE_HOSTED;
    process.env.AGENTBASE_LLM_BASE_URL = 'https://agentbase.example.com/llm/v1';
    delete process.env.AGENTBASE_LLM_MODEL_EXAMPLE_AGENT;
    expect(resolveAgentModel('example-agent', 'google/gemini-2.5-flash')).toBe(
      'google/gemini-2.5-flash',
    );
  });

  it('builds a gateway-backed model when both are set, keyed to this specific agent id', () => {
    setConfig();
    const result = resolveAgentModel('example-agent', 'google/gemini-2.5-flash');
    expect(result).not.toBe('google/gemini-2.5-flash');
    expect(typeof result).toBe('object');
    expect((result as { modelId: string }).modelId).toBe('google/gemini-2.5-flash');
    expect((result as { provider: string }).provider).toBe('agentbase.chat');
  });

  it('does not use another agent’s env vars (one config per agent id)', () => {
    setConfig(); // only *_EXAMPLE_AGENT is set; not AgentBase-hosted
    delete process.env.AGENTBASE_HOSTED;
    expect(resolveAgentModel('summary-agent', 'anthropic/claude-sonnet-5')).toBe(
      'anthropic/claude-sonnet-5',
    );
  });

  it('on an AgentBase-hosted container, an unconfigured agent does NOT fall back to the env key', () => {
    process.env.AGENTBASE_HOSTED = '1';
    delete process.env.AGENTBASE_LLM_BASE_URL;
    delete process.env.AGENTBASE_LLM_MODEL_EXAMPLE_AGENT;
    const result = resolveAgentModel('example-agent', 'google/gemini-2.5-flash');
    // A model object, never the fallback string — the org must set the model in Studio.
    expect(result).not.toBe('google/gemini-2.5-flash');
    expect((result as { modelId: string }).modelId).toBe('unconfigured');
  });

  it('the unconfigured-hosted model fails at CALL time with an actionable message', async () => {
    process.env.AGENTBASE_HOSTED = '1';
    delete process.env.AGENTBASE_LLM_MODEL_EXAMPLE_AGENT;
    const result = resolveAgentModel('example-agent', 'google/gemini-2.5-flash') as unknown as {
      doGenerate: (o: unknown) => Promise<unknown>;
    };
    await expect(
      result.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    ).rejects.toThrow(/no model configured|LLM configuration/i);
  });
});

describe('getAgentBaseLlmToken', () => {
  it('throws a clear error when the service credentials are not fully set', async () => {
    delete process.env.AGENTBASE_LLM_CLIENT_ID_EXAMPLE_AGENT;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(getAgentBaseLlmToken('example-agent')).rejects.toThrow(
      /AGENTBASE_LLM_CLIENT_ID_EXAMPLE_AGENT/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mints via the standard OAuth2 client_credentials grant, keyed to this agent id', async () => {
    setConfig();
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'jwt-1', expires_in: 1800 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const token = await getAgentBaseLlmToken('example-agent');

    expect(token).toBe('jwt-1');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(process.env.AGENTBASE_LLM_TOKEN_URL);
    expect(String(init.body)).toContain('client_id=svc-client-id');
    expect(String(init.body)).toContain('client_secret=svc-client-secret');
  });

  it('caches the token and re-mints once near expiry', async () => {
    setConfig();
    vi.useFakeTimers();
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({ access_token: `jwt-${call}`, expires_in: 60 }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getAgentBaseLlmToken('example-agent')).toBe('jwt-1');
    expect(await getAgentBaseLlmToken('example-agent')).toBe('jwt-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(45_000); // past (60s - 30s skew)
    expect(await getAgentBaseLlmToken('example-agent')).toBe('jwt-2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws a clear error on a non-ok token response', async () => {
    setConfig();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid_client', { status: 401 })),
    );
    await expect(getAgentBaseLlmToken('example-agent')).rejects.toThrow(/401/);
  });
});

describe('account-level AgentBase credentials (--llm-provider=agentbase)', () => {
  /**
   * AGT-008. The platform injects SUFFIXED per-agent vars when it hosts the
   * container; a developer supplies UNSUFFIXED ones in `.env` so the org's
   * onboarded models are usable from local dev / Standalone / External, where
   * nothing is injected.
   */
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  function clearAgentBase() {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('AGENTBASE_')) delete process.env[k];
    }
  }

  it('reports configured when the account-level set is complete', () => {
    clearAgentBase();
    process.env.AGENTBASE_LLM_BASE_URL = 'https://api.ab.test/llm/v1';
    process.env.AGENTBASE_LLM_TOKEN_URL = 'https://auth.ab.test/token';
    process.env.AGENTBASE_LLM_CLIENT_ID = 'cid';
    process.env.AGENTBASE_LLM_CLIENT_SECRET = 'secret';
    expect(isAgentBaseLlmConfigured()).toBe(true);
  });

  it('reports NOT configured when a piece is missing', () => {
    clearAgentBase();
    process.env.AGENTBASE_LLM_BASE_URL = 'https://api.ab.test/llm/v1';
    process.env.AGENTBASE_LLM_CLIENT_ID = 'cid';
    // no token URL, no secret
    expect(isAgentBaseLlmConfigured()).toBe(false);
  });

  it('uses the account-level model when no per-agent one is injected', () => {
    clearAgentBase();
    process.env.AGENTBASE_LLM_BASE_URL = 'https://api.ab.test/llm/v1';
    process.env.AGENTBASE_LLM_TOKEN_URL = 'https://auth.ab.test/token';
    process.env.AGENTBASE_LLM_CLIENT_ID = 'cid';
    process.env.AGENTBASE_LLM_CLIENT_SECRET = 'secret';
    process.env.AGENTBASE_LLM_MODEL = 'anthropic/claude-sonnet-5';

    // A gateway-backed model object, not the plain fallback string.
    const model = resolveAgentModel('example-agent', 'google/gemini-2.5-flash');
    expect(typeof model).not.toBe('string');
  });

  it('lets an injected PER-AGENT model win over the account-level one', () => {
    // On a hosted container the org admin's Studio choice must not be
    // overridable by a value someone left in the repo's .env.
    clearAgentBase();
    process.env.AGENTBASE_LLM_BASE_URL = 'https://api.ab.test/llm/v1';
    process.env.AGENTBASE_LLM_TOKEN_URL = 'https://auth.ab.test/token';
    process.env.AGENTBASE_LLM_CLIENT_ID = 'account-cid';
    process.env.AGENTBASE_LLM_CLIENT_SECRET = 'account-secret';
    process.env.AGENTBASE_LLM_MODEL = 'account/model';
    process.env.AGENTBASE_LLM_MODEL_EXAMPLE_AGENT = 'admin/chosen-model';

    const model = resolveAgentModel('example-agent', 'google/gemini-2.5-flash');
    expect(typeof model).not.toBe('string');
    expect(JSON.stringify(model)).toContain('admin/chosen-model');
  });

  it('stays out of the way when nothing AgentBase is set', () => {
    clearAgentBase();
    expect(isAgentBaseLlmConfigured()).toBe(false);
    expect(resolveAgentModel('example-agent', 'google/gemini-2.5-flash')).toBe(
      'google/gemini-2.5-flash',
    );
  });
});
