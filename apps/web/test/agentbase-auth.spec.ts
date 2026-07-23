import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentBaseAccessToken, resetAgentBaseTokenCacheForTests } from '../app/lib/agentbase-auth';

const ENV_KEYS = ['AGENTBASE_TOKEN_URL', 'AGENTBASE_CLIENT_ID', 'AGENTBASE_CLIENT_SECRET'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  resetAgentBaseTokenCacheForTests();
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
  process.env.AGENTBASE_TOKEN_URL = 'https://keycloak.example.com/realms/agentbase/protocol/openid-connect/token';
  process.env.AGENTBASE_CLIENT_ID = 'app-client-id';
  process.env.AGENTBASE_CLIENT_SECRET = 'app-client-secret';
}

describe('getAgentBaseAccessToken', () => {
  it('returns a clear config error when the Application credentials are not fully set', async () => {
    delete process.env.AGENTBASE_TOKEN_URL;
    delete process.env.AGENTBASE_CLIENT_ID;
    delete process.env.AGENTBASE_CLIENT_SECRET;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getAgentBaseAccessToken();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/AGENTBASE_TOKEN_URL|AGENTBASE_CLIENT_ID|AGENTBASE_CLIENT_SECRET/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mints via the standard OAuth2 client_credentials grant and returns the token', async () => {
    setConfig();
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'jwt-1', expires_in: 1800, token_type: 'Bearer' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getAgentBaseAccessToken();

    expect(result).toEqual({ ok: true, accessToken: 'jwt-1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(process.env.AGENTBASE_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('grant_type=client_credentials');
    expect(String(init.body)).toContain('client_id=app-client-id');
    expect(String(init.body)).toContain('client_secret=app-client-secret');
  });

  it('caches the token and does not re-mint before expiry', async () => {
    setConfig();
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'jwt-1', expires_in: 1800 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await getAgentBaseAccessToken();
    const second = await getAgentBaseAccessToken();

    expect(second).toEqual({ ok: true, accessToken: 'jwt-1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-mints once the cached token is near expiry', async () => {
    setConfig();
    vi.useFakeTimers();
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({ access_token: `jwt-${call}`, expires_in: 60 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const first = await getAgentBaseAccessToken();
    expect(first).toEqual({ ok: true, accessToken: 'jwt-1' });

    vi.advanceTimersByTime(45_000); // past (60s - 30s skew)
    const second = await getAgentBaseAccessToken();

    expect(second).toEqual({ ok: true, accessToken: 'jwt-2' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns a clear error on a non-ok token response', async () => {
    setConfig();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid_client', { status: 401 })),
    );

    const result = await getAgentBaseAccessToken();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/401/);
  });

  it('returns a clear error when the token request throws', async () => {
    setConfig();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await getAgentBaseAccessToken();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });
});
