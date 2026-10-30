import { describe, expect, it } from 'vitest';
import {
  ConnectError,
  FIELDS,
  connect,
  findModel,
  isPlaceholder,
  listModels,
  mintToken,
  parseFlags,
} from '../../../scripts/connect-agentbase.mjs';

/**
 * APP-025: `pnpm connect` proves an AgentBase connection before writing it.
 *
 * Every failure below is one a person who has never seen OAuth will hit on
 * their first afternoon with Studio: a token URL copied from the wrong place, a
 * secret that was rotated, an API address that is really the Studio address, a
 * model that the Application was never subscribed to. Each has to come back as
 * a sentence naming where to look, and the secret must never appear in any of
 * them. Exercised with a fake `fetch`; nothing leaves the process.
 */
const SECRET = 'sekrit-value-never-shown';
// Studio's tab carries the boilerplate's name in every project, but this file is a rename target:
// written out, the name would be renamed here and not in the script, and the case would fail in
// every derived project. Assembled at runtime, as in rename-project.spec.ts.
const STUDIO_TAB = ['Pre', 'cast'].join('') + ' tab';
const VALUES = {
  AGENTBASE_URL: 'https://api.agentbase.test',
  AGENTBASE_TOKEN_URL: 'https://kc.agentbase.test/realms/agentbase/protocol/openid-connect/token',
  AGENTBASE_CLIENT_ID: 'client-123',
  AGENTBASE_CLIENT_SECRET: SECRET,
  AGENTBASE_LLM_MODEL: 'gemini-35-flash-a8c31bbc',
};
const MODELS = [
  {
    slug: 'gemini-35-flash-a8c31bbc',
    modelId: 'gemini-3.5-flash',
    provider: 'google',
    orgSlug: 'o',
  },
  {
    slug: 'claude-sonnet-5-11aa22bb',
    modelId: 'claude-sonnet-5',
    provider: 'anthropic',
    orgSlug: 'o',
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mcpModels = (items: unknown[]) =>
  json({ jsonrpc: '2.0', id: 1, result: { content: [{ text: JSON.stringify({ items }) }] } });

/** A fetch that answers the token URL and the MCP endpoint, recording what it was sent. */
function fakeFetch(opts: { token?: Response | Error; models?: Response | Error } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const answer = url.endsWith('/token') ? opts.token : opts.models;
    if (answer instanceof Error) throw answer;
    if (answer) return answer;
    return url.endsWith('/token')
      ? json({ access_token: 'tok', expires_in: 1800 })
      : mcpModels(MODELS);
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function collectLog() {
  const lines: string[] = [];
  return { log: { log: (s: string) => lines.push(s) } as unknown as Console, lines };
}

describe('APP-025 pnpm connect: proves the connection before writing it', () => {
  it('mints a token with the client_credentials grant, form-encoded, like the apps do', async () => {
    const { fetch, calls } = fakeFetch();
    const token = await mintToken({ ...tokenArgs(), fetch });
    expect(token).toBe('tok');
    const body = calls[0].init?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-123');
    expect(body.get('client_secret')).toBe(SECRET);
    expect((calls[0].init?.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it("a rejected id or secret says so and points at the Application's tab in Studio, without the secret", async () => {
    const { fetch } = fakeFetch({ token: json({ error: 'invalid_client' }, 401) });
    const err = await mintToken({ ...tokenArgs(), fetch }).catch((e: unknown) => e as ConnectError);
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.step).toBe('token');
    expect(err.message).toMatch(/client id or secret/);
    expect(err.hint).toContain(STUDIO_TAB);
    expect(err.message + err.hint).not.toContain(SECRET);
  });

  it('a token URL that is not a token endpoint is named as such', async () => {
    const { fetch } = fakeFetch({ token: new Response('<html>', { status: 404 }) });
    const err = await mintToken({ ...tokenArgs(), fetch }).catch((e: unknown) => e as ConnectError);
    expect(err.message).toMatch(/HTTP 404: that address is not a token endpoint/);
  });

  it('an unreachable token URL says "could not reach" and names the address', async () => {
    const boom = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const { fetch } = fakeFetch({ token: boom });
    const err = await mintToken({ ...tokenArgs(), fetch }).catch((e: unknown) => e as ConnectError);
    expect(err.message).toContain('Could not reach the token URL');
    expect(err.message).toContain(VALUES.AGENTBASE_TOKEN_URL);
    expect(err.message).toContain('ENOTFOUND');
  });

  it('lists models through agentbase.list_models with the bearer, and matches three spellings', async () => {
    const { fetch, calls } = fakeFetch();
    const items = await listModels({ apiUrl: VALUES.AGENTBASE_URL + '/', token: 'tok', fetch });
    expect(calls[0].url).toBe('https://api.agentbase.test/mcp');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init?.body as string).params.name).toBe('agentbase.list_models');
    expect(items).toHaveLength(2);
    expect(findModel(items, 'gemini-35-flash-a8c31bbc')?.slug).toBe('gemini-35-flash-a8c31bbc');
    expect(findModel(items, 'google/gemini-3.5-flash')?.slug).toBe('gemini-35-flash-a8c31bbc');
    expect(findModel(items, 'claude-sonnet-5')?.slug).toBe('claude-sonnet-5-11aa22bb');
    expect(findModel(items, 'nope')).toBeUndefined();
  });

  it('an API address that refuses the token is blamed on the address, not the secret', async () => {
    const { fetch } = fakeFetch({ models: json({}, 403) });
    const err = await listModels({ apiUrl: VALUES.AGENTBASE_URL, token: 'tok', fetch }).catch(
      (e: unknown) => e as ConnectError,
    );
    expect(err.step).toBe('models');
    expect(err.message).toMatch(/token works, but the API .* refused it \(HTTP 403\)/);
    expect(err.hint).toMatch(/different AgentBase installations/);
  });

  it('writes the four credentials and the model to .env only after all three checks pass', async () => {
    const { fetch } = fakeFetch();
    const { log, lines } = collectLog();
    const envText = 'AGENTBASE_URL=https://api.agentbase.example.com\nLOG_LEVEL=info\n';
    const r = await connect({ values: VALUES, envText, fetch, log });
    expect(r.ok).toBe(true);
    expect(r.written).toEqual([
      'AGENTBASE_URL',
      'AGENTBASE_TOKEN_URL',
      'AGENTBASE_CLIENT_ID',
      'AGENTBASE_CLIENT_SECRET',
      'AGENTBASE_LLM_MODEL',
    ]);
    expect(r.envText).toContain('AGENTBASE_URL=https://api.agentbase.test\n');
    expect(r.envText).toContain(`AGENTBASE_CLIENT_SECRET=${SECRET}\n`);
    expect(r.envText).toContain('AGENTBASE_LLM_MODEL=gemini-35-flash-a8c31bbc\n');
    expect(r.envText).toContain('LOG_LEVEL=info\n');
    expect(lines.join('\n')).toMatch(/1\/3[\s\S]*2\/3 2 models[\s\S]*3\/3/);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('--check verifies and writes nothing', async () => {
    const { fetch } = fakeFetch();
    const r = await connect({
      values: VALUES,
      envText: 'X=1\n',
      check: true,
      fetch,
      log: collectLog().log,
    });
    expect(r.ok).toBe(true);
    expect(r.written).toEqual([]);
    expect(r.envText).toBe('X=1\n');
  });

  it('a model the Application is not subscribed to: credentials saved, the published list shown', async () => {
    const { fetch } = fakeFetch();
    const r = await connect({
      values: { ...VALUES, AGENTBASE_LLM_MODEL: 'gpt-9' },
      fetch,
      log: collectLog().log,
    });
    expect(r.ok).toBe(false);
    expect(r.step).toBe('model');
    expect(r.written).not.toContain('AGENTBASE_LLM_MODEL');
    expect(r.written).toContain('AGENTBASE_CLIENT_SECRET');
    expect(r.message).toContain('"gpt-9" is not published');
    expect(r.hint).toContain('claude-sonnet-5-11aa22bb, gemini-35-flash-a8c31bbc');
  });

  it('no model chosen: the published list is the answer; no models at all: subscribe first', async () => {
    const none = await connect({
      values: { ...VALUES, AGENTBASE_LLM_MODEL: '' },
      fetch: fakeFetch().fetch,
      log: collectLog().log,
    });
    expect(none.ok).toBe(false);
    expect(none.hint).toMatch(/Pick one of: claude-sonnet-5-11aa22bb, gemini-35-flash-a8c31bbc/);

    const empty = await connect({
      values: VALUES,
      fetch: fakeFetch({ models: mcpModels([]) }).fetch,
      log: collectLog().log,
    });
    expect(empty.ok).toBe(false);
    expect(empty.message).toMatch(/no published models yet/);
    expect(empty.hint).toMatch(/open Models and subscribe/);
  });

  it('placeholders from .env.example count as unset, and the failure names what is missing', async () => {
    expect(isPlaceholder('https://api.agentbase.example.com')).toBe(true);
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder('https://api.agentbase.test')).toBe(false);
    const err = await connect({
      values: { ...VALUES, AGENTBASE_TOKEN_URL: 'https://keycloak.example.com/x/token' },
      fetch: fakeFetch().fetch,
      log: collectLog().log,
    }).catch((e: unknown) => e as ConnectError);
    expect(err.step).toBe('input');
    expect(err.message).toBe('Not enough to connect: AGENTBASE_TOKEN_URL is not set.');
  });

  it("flags mirror bootstrap's names, one per field, plus --check", () => {
    expect(FIELDS.map((f) => f.flag)).toEqual([
      'agentbase-url',
      'agentbase-token-url',
      'agentbase-client-id',
      'agentbase-client-secret',
      'agentbase-model',
    ]);
    expect(parseFlags(['--check', '--agentbase-model=a=b', 'positional'])).toEqual({
      check: true,
      'agentbase-model': 'a=b',
    });
  });
});

function tokenArgs() {
  return {
    tokenUrl: VALUES.AGENTBASE_TOKEN_URL,
    clientId: VALUES.AGENTBASE_CLIENT_ID,
    clientSecret: SECRET,
  };
}
