import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2UI_EXTENSION_URI, A2UI_MIME_TYPE, RAYA_BLOCKS_CATALOG_ID } from '@precast/a2ui';
import { createAuthMiddleware } from './auth';
import { createA2uiMiddleware } from './a2ui';
import { showCard } from '../tools/show-card';

/**
 * AGT-014: the A2UI middleware on a real Hono app (the version Mastra runs on), with a stand-in
 * for Mastra's A2A route that behaves as Mastra 1.78 does: it reads the body with `c.req.json()`,
 * fails the turn on any data part, and answers `message/send` with a completed task whose text
 * sits in its last artifact. The stand-in "agent" calls the same `showCard` the tool runs.
 */

const card = {
  title: 'Deploy failed',
  text: 'Staging is still on the previous build.',
  buttons: [{ label: 'Retry deploy', action: 'retry', value: '4f21a9', style: 'primary' }],
};

type Turn = { sawParts: unknown[]; drawCard: boolean };

function app(
  opts: { drawCard?: boolean; stream?: boolean; signed?: boolean; skills?: string[] } = {},
) {
  const log = { warn: vi.fn(), debug: vi.fn() };
  const turn: Turn = { sawParts: [], drawCard: opts.drawCard ?? false };
  const h = new Hono();
  h.use('*', createAuthMiddleware() as never);
  h.use('*', createA2uiMiddleware(log) as never);

  h.post('/api/a2a/:agentId', async (c) => {
    const rpc = (await c.req.json()) as {
      id: number;
      params: { message: { parts: Array<{ kind?: string; text?: string; data?: unknown }> } };
    };
    const parts = rpc.params.message.parts;
    turn.sawParts = parts;
    if (parts.some((p) => p.kind === 'data' || (p.kind === undefined && 'data' in p))) {
      return c.json({
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -32603, message: 'Data parts are not supported in core messages' },
      });
    }
    // '#card' in the text draws one too, so concurrent turns can differ.
    if (turn.drawCard || parts.some((p) => p.text?.includes('#card'))) {
      await new Promise((r) => setTimeout(r, 10));
      showCard(card, 'card-1');
    }
    // '#slow' (30ms) and '#mid' (20ms) keep a turn in flight after any drawing is done.
    const wait = parts.some((p) => p.text?.includes('#slow'))
      ? 30
      : parts.some((p) => p.text?.includes('#mid'))
        ? 20
        : 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (opts.stream) {
      return new Response('data: {"jsonrpc":"2.0"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    const v1 = c.req.header('A2A-Version') === '1.0';
    const text = v1 ? { text: 'Done.' } : { kind: 'text', text: 'Done.' };
    const task = {
      id: 't1',
      status: { state: 'completed' },
      artifacts: [{ artifactId: 't1:response', parts: [text] }],
    };
    return c.json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: v1 ? { task } : { kind: 'task', ...task },
    });
  });

  h.get('/api/.well-known/:agentId/agent-card.json', (c) =>
    c.json({
      name: c.req.param('agentId'),
      capabilities: { streaming: true, extensions: [] },
      skills: (opts.skills ?? ['example-echo', 'show_card']).map((id) => ({ id, name: id })),
      ...(opts.signed ? { signatures: [{ protected: 'x', signature: 'y' }] } : {}),
    }),
  );
  return { h, log, turn };
}

const send = (parts: unknown[], metadata?: unknown) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: 'm1',
        parts,
        ...(metadata ? { metadata } : {}),
      },
    },
  });

const post = (h: Hono, body: string, headers: Record<string, string> = {}) =>
  h.request('/api/a2a/example-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

const lastParts = (json: {
  result: {
    artifacts?: Array<{ parts: unknown[] }>;
    task?: { artifacts: Array<{ parts: unknown[] }> };
  };
}) => (json.result.task ?? json.result).artifacts!.at(-1)!.parts;

afterEach(() => {
  delete process.env.AGENT_API_TOKEN;
});

describe('AGT-014 A2UI cards on replies', () => {
  it('attaches the card the turn drew as one A2UI data part beside the text (A2A 0.3)', async () => {
    const { h } = app({ drawCard: true });
    const res = await post(h, send([{ kind: 'text', text: 'deploy status?' }]));
    const json = await res.json();
    const parts = lastParts(json);
    expect(parts[0]).toEqual({ kind: 'text', text: 'Done.' });
    expect(parts[1]).toMatchObject({ kind: 'data', metadata: { mimeType: A2UI_MIME_TYPE } });
    const messages = (parts[1] as { data: Array<Record<string, unknown>> }).data;
    expect(messages[0]).toEqual({
      version: 'v0.9.1',
      createSurface: { surfaceId: 'card-1', catalogId: RAYA_BLOCKS_CATALOG_ID },
    });
    expect(res.headers.get('X-A2A-Extensions')).toBe(A2UI_EXTENSION_URI);
    expect(res.headers.get('content-length')).not.toBe('0');
  });

  it('speaks A2A 1.0 when the caller does', async () => {
    const { h } = app({ drawCard: true });
    const res = await post(h, send([{ text: 'deploy status?' }]), { 'A2A-Version': '1.0' });
    const parts = lastParts(await res.json());
    expect(parts[1]).toMatchObject({
      mediaType: A2UI_MIME_TYPE,
      metadata: { mimeType: A2UI_MIME_TYPE },
    });
    expect(parts[1]).not.toHaveProperty('kind');
  });

  it('leaves a reply with no card exactly as Mastra sent it', async () => {
    const { h } = app();
    const res = await post(h, send([{ kind: 'text', text: 'hi' }]));
    expect(lastParts(await res.json())).toEqual([{ kind: 'text', text: 'Done.' }]);
    expect(res.headers.get('X-A2A-Extensions')).toBeNull();
  });

  it('respects a caller whose declared catalogs leave ours out', async () => {
    const { h } = app({ drawCard: true });
    const res = await post(
      h,
      send([{ kind: 'text', text: 'hi' }], {
        a2uiClientCapabilities: { 'v0.9.1': { supportedCatalogIds: ['other.catalog'] } },
      }),
    );
    expect(lastParts(await res.json())).toHaveLength(1);
  });

  it('passes a stream through untouched and says the card was dropped', async () => {
    const { h, log } = app({ drawCard: true, stream: true });
    const res = await post(h, send([{ kind: 'text', text: 'hi' }]));
    expect(await res.text()).toBe('data: {"jsonrpc":"2.0"}\n\n');
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/streams/));
  });

  it('never attaches across turns: each request has its own card slot', async () => {
    const { h } = app();
    // One turn draws at 10ms and answers at 40ms; the other draws nothing and answers at 20ms,
    // in between. A slot shared across requests would hand it the first turn's card.
    const [drew, plain] = await Promise.all([
      post(h, send([{ kind: 'text', text: '#card #slow' }])),
      post(h, send([{ kind: 'text', text: 'just text #mid' }])),
    ]);
    expect(lastParts(await drew.json())).toHaveLength(2);
    expect(lastParts(await plain.json())).toHaveLength(1);
    const after = await post(h, send([{ kind: 'text', text: 'three' }]));
    expect(lastParts(await after.json())).toHaveLength(1);
  });

  it('does not run when auth refuses the call', async () => {
    process.env.AGENT_API_TOKEN = 'secret';
    const { h, turn } = app({ drawCard: true });
    const res = await post(h, send([{ kind: 'text', text: 'hi' }]));
    expect(res.status).toBe(401);
    expect(turn.sawParts).toEqual([]);
  });
});

describe('AGT-014 A2UI presses reach Mastra without data parts', () => {
  it('turns a press with no text into a text message, so the turn does not fail', async () => {
    const { h, turn } = app();
    const press = {
      kind: 'data',
      metadata: { mimeType: A2UI_MIME_TYPE },
      data: { version: 'v0.9.1', action: { name: 'retry', value: '4f21a9' } },
    };
    const res = await post(h, send([press]));
    const json = await res.json();
    expect(json.error).toBeUndefined();
    expect(turn.sawParts).toHaveLength(1);
    const text = (turn.sawParts[0] as { kind: string; text: string }).text;
    expect(text).toContain('"name":"retry"');
    expect(text).toContain('"value":"4f21a9"');
  });

  it('drops the data part when the press came with text, as Raya sends it', async () => {
    const { h, turn } = app();
    const press = {
      kind: 'data',
      metadata: { mimeType: A2UI_MIME_TYPE },
      data: { action: { name: 'retry' } },
    };
    await post(h, send([{ kind: 'text', text: 'A control you rendered was used.' }, press]));
    expect(turn.sawParts).toEqual([{ kind: 'text', text: 'A control you rendered was used.' }]);
  });

  it('leaves a body that is not JSON for Mastra to reject', async () => {
    const { h } = app();
    const res = await post(h, '{not json');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('AGT-014 the agent card advertises A2UI', () => {
  const getCard = (h: Hono) => h.request('/api/.well-known/example-agent/agent-card.json');

  it('lists the extension when the agent has show_card', async () => {
    const { h } = app();
    const json = await (await getCard(h)).json();
    expect(json.capabilities.extensions).toEqual([
      expect.objectContaining({
        uri: A2UI_EXTENSION_URI,
        required: false,
        params: { supportedCatalogIds: [RAYA_BLOCKS_CATALOG_ID], acceptsInlineCatalogs: false },
      }),
    ]);
  });

  it('leaves an agent without show_card alone', async () => {
    const { h } = app({ skills: ['example-echo'] });
    expect((await (await getCard(h)).json()).capabilities.extensions).toEqual([]);
  });

  it('leaves a signed card alone rather than break its signature', async () => {
    const { h, log } = app({ signed: true });
    expect((await (await getCard(h)).json()).capabilities.extensions).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/signed/));
  });
});

describe('AGT-015 show_card', () => {
  it('holds nothing and says so outside a request', () => {
    expect(showCard(card)).toEqual({ shown: false, reason: expect.stringMatching(/replies/) });
  });

  it('refuses a card with nothing to show', () => {
    expect(showCard({ buttons: [{ label: 'no action' }] })).toMatchObject({
      shown: false,
      reason: expect.stringMatching(/Answer in text/),
    });
  });
});
