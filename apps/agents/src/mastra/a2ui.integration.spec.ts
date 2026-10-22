import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createHonoServer } from '@mastra/deployer/server';
import { A2UI_EXTENSION_URI, A2UI_MIME_TYPE } from '@precast/a2ui';
import { beforeAll, describe, expect, it } from 'vitest';
import { a2uiMiddleware } from './middleware/a2ui';
import { agentAuthMiddleware } from './middleware/auth';
import { cardTools, SHOW_CARD_INSTRUCTIONS } from './tools/show-card';

/**
 * AGT-016: A2UI through Mastra's own A2A server, not a stand-in. The model is scripted over the
 * OpenAI-compatible wire: on the first call it asks for `show_card`, on the second it answers in
 * text. Everything between (tool validation, tool execution, the A2A handler, the task format) is
 * the real Mastra 1.78 code path, so a Mastra upgrade that moves the reply breaks this test.
 */

const CARD_ARGS = {
  title: 'Deploy failed',
  text: 'Staging is still on the previous build.',
  buttons: [{ label: 'Retry deploy', action: 'retry', value: '4f21a9', style: 'primary' }],
};

/** What the model was sent on each call, newest last. */
const modelCalls: Array<{ stream?: boolean; messages: Array<{ role: string; content: unknown }> }> =
  [];

type Turn = { content?: string; toolCall?: { name: string; arguments: string } };

/** One scripted model turn, in whichever form the caller asked for. */
function reply(turn: Turn, stream: boolean | undefined): Response {
  const tool_calls = turn.toolCall
    ? [{ index: 0, id: 'call_1', type: 'function', function: turn.toolCall }]
    : undefined;
  const finish = turn.toolCall ? 'tool_calls' : 'stop';
  if (!stream) {
    return Response.json({
      id: 'c1',
      object: 'chat.completion',
      created: 0,
      model: 'scripted',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: turn.content ?? null, tool_calls },
          finish_reason: finish,
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  return sse([chunk({ role: 'assistant', content: turn.content, tool_calls }), chunk({}, finish)]);
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (delta: unknown, finish: string | null = null) => ({
  id: 'c1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'scripted',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(finish ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : {}),
});

const scripted = createOpenAICompatible({
  name: 'scripted',
  baseURL: 'https://scripted.invalid/v1',
  apiKey: 'unused',
  fetch: async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as (typeof modelCalls)[number];
    modelCalls.push(req);
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const wantsCard = JSON.stringify(lastUser?.content ?? '').includes('#card');
    const toolDone = req.messages.some((m) => m.role === 'tool');
    if (wantsCard && !toolDone) {
      return reply(
        { toolCall: { name: 'show_card', arguments: JSON.stringify(CARD_ARGS) } },
        req.stream,
      );
    }
    return reply({ content: 'Done.' }, req.stream);
  },
})('scripted');

let app: Awaited<ReturnType<typeof createHonoServer>>;

beforeAll(async () => {
  const agent = new Agent({
    id: 'card-agent',
    name: 'Card Agent',
    instructions: `Test agent.\n\n${SHOW_CARD_INSTRUCTIONS}`,
    model: scripted,
    tools: { ...cardTools },
  });
  const mastra = new Mastra({
    agents: { 'card-agent': agent },
    server: { middleware: [agentAuthMiddleware, a2uiMiddleware] },
  });
  app = await createHonoServer(mastra, { tools: {} });
});

const send = (text: string | null, extra: unknown[] = [], headers: Record<string, string> = {}) =>
  app.request('/api/a2a/card-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          role: 'user',
          messageId: crypto.randomUUID(),
          parts: [...(text ? [{ kind: 'text', text }] : []), ...extra],
        },
      },
    }),
  });

type Reply = {
  error?: { message: string };
  result: {
    kind?: string;
    artifacts?: Array<{ parts: Array<Record<string, unknown>> }>;
    task?: { artifacts: Array<{ parts: Array<Record<string, unknown>> }> };
  };
};
const partsOf = (r: Reply) => (r.result.task ?? r.result).artifacts!.at(-1)!.parts;

describe('AGT-016 A2UI through the real Mastra A2A server', () => {
  it('advertises the extension on the agent card Mastra serves', async () => {
    const res = await app.request('/api/.well-known/card-agent/agent-card.json');
    const card = (await res.json()) as {
      skills: Array<{ id: string }>;
      capabilities: { extensions: Array<{ uri: string }> };
    };
    expect(card.skills.map((s) => s.id)).toContain('show_card');
    expect(card.capabilities.extensions.map((e) => e.uri)).toContain(A2UI_EXTENSION_URI);
  });

  it('attaches the card the model drew to the reply, beside its text', async () => {
    const res = await send('#card deploy status?');
    const reply = (await res.json()) as Reply;
    expect(reply.error).toBeUndefined();
    const parts = partsOf(reply);
    expect(parts.find((p) => p.kind === 'text')).toMatchObject({ text: 'Done.' });
    const a2ui = parts.find((p) => p.kind === 'data');
    expect(a2ui).toMatchObject({ metadata: { mimeType: A2UI_MIME_TYPE } });
    const update = (
      a2ui!.data as Array<{ updateComponents?: { components: Array<{ component: string }> } }>
    )[1];
    expect(update!.updateComponents!.components.map((c) => c.component)).toEqual([
      'Stack',
      'Header',
      'Section',
      'Button',
      'Actions',
    ]);
    expect(res.headers.get('X-A2A-Extensions')).toBe(A2UI_EXTENSION_URI);
  });

  it('does the same on the A2A 1.0 wire', async () => {
    const res = await send('#card deploy status?', [], { 'A2A-Version': '1.0' });
    const reply = (await res.json()) as Reply;
    expect(reply.error).toBeUndefined();
    expect(partsOf(reply).at(-1)).toMatchObject({ mediaType: A2UI_MIME_TYPE });
  });

  it('a text-only turn gets a reply with no card', async () => {
    const reply = (await (await send('hello')).json()) as Reply;
    expect(partsOf(reply).some((p) => p.kind === 'data')).toBe(false);
  });

  it('a press sent only as an A2UI data part reaches the model as text instead of failing the turn', async () => {
    const press = {
      kind: 'data',
      metadata: { mimeType: A2UI_MIME_TYPE },
      data: { version: 'v0.9.1', action: { name: 'retry', value: '4f21a9' } },
    };
    const reply = (await (await send(null, [press])).json()) as Reply;
    expect(reply.error).toBeUndefined();
    const seen = JSON.stringify(modelCalls.at(-1)!.messages);
    expect(seen).toContain('\\"name\\":\\"retry\\"');
    expect(seen).not.toContain('Data parts are not supported');
  });
});
