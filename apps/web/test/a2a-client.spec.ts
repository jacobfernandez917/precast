import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/lib/agentbase-auth', () => ({
  getAgentBaseAccessToken: vi.fn(),
}));

import { callAgent } from '../app/lib/a2a-client';
import { getAgentBaseAccessToken } from '../app/lib/agentbase-auth';

const mockedGetToken = vi.mocked(getAgentBaseAccessToken);

const AGENT_URL_VAR = 'AGENTBASE_AGENT_URL_EXAMPLE_AGENT';
const ENV_KEYS = ['ENABLE_AGENTBASE', AGENT_URL_VAR, 'MASTRA_INTERNAL_URL', 'AGENT_API_TOKEN'] as const;
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
    process.env.ENABLE_AGENTBASE = '1';
    process.env[AGENT_URL_VAR] = 'https://agentbase.acme.dev/proxy/a2a/acme/example-agent-a1b2c3d4';
  });

  it('guard-rails when the agent has no AGENTBASE_AGENT_URL_* var set', async () => {
    delete process.env[AGENT_URL_VAR];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const reply = await callAgent('example-agent', 'hi');

    expect(reply.ok).toBe(false);
    expect(reply.via).toBe('agentbase');
    expect(reply.error).toMatch(/AGENTBASE_AGENT_URL_EXAMPLE_AGENT/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedGetToken).not.toHaveBeenCalled(); // no point minting without a target URL
  });

  it('derives the env var name from the agent id (uppercase, non-alphanumeric -> _)', async () => {
    process.env.AGENTBASE_AGENT_URL_SLACK_DAILY_DIGEST =
      'https://agentbase.acme.dev/proxy/a2a/acme/slack-daily-digest-73a6577a';
    mockedGetToken.mockResolvedValue({ ok: true, accessToken: 'jwt' });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }));
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
    expect(reply.error).toBe('Application credentials not set');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the plain A2A message/send envelope (no slug/skill wrapper) with the minted bearer', async () => {
    mockedGetToken.mockResolvedValue({ ok: true, accessToken: 'minted-jwt' });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const reply = await callAgent('example-agent', 'hi there', { sessionId: 'sess-1' });

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
    expect(body.params.message.contextId).toBe('sess-1');

    expect(reply).toMatchObject({ ok: true, via: 'agentbase', text: 'hello back' });
  });
});

describe('callAgent — direct mode (ENABLE_AGENTBASE=0)', () => {
  it('sends a message/send A2A envelope straight to Mastra, bypassing AgentBase entirely', async () => {
    process.env.ENABLE_AGENTBASE = '0';
    process.env.MASTRA_INTERNAL_URL = 'http://localhost:4111';
    process.env.AGENT_API_TOKEN = 'mastra-token';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(A2A_MESSAGE_RESPONSE), { status: 200 }));
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
