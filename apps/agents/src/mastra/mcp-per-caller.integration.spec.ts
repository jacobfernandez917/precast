import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { createHonoServer } from '@mastra/deployer/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agentAuthMiddleware } from './middleware/auth';
import { currentOnBehalfOf } from './lib/request-context';

/**
 * AGT-025: Mastra asks for an agent's tools inside the caller's request, so a
 * tools function that answers per caller (as `createAgentMcpToolset().current()`
 * does) gives each user their own tools. Run through Mastra's own A2A server with
 * a scripted model, which records the tool names it was offered on every call.
 */

const offered: Array<{ subject: string | null; tools: string[] }> = [];

const scripted = createOpenAICompatible({
  name: 'scripted',
  baseURL: 'https://scripted.invalid/v1',
  apiKey: 'unused',
  fetch: async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as {
      tools?: Array<{ function: { name: string } }>;
      messages: Array<{ role: string; content: unknown }>;
    };
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const subject = /as (\w+)/.exec(JSON.stringify(lastUser?.content ?? ''))?.[1] ?? null;
    offered.push({ subject, tools: (req.tools ?? []).map((t) => t.function.name) });
    return Response.json({
      id: 'c1',
      object: 'chat.completion',
      created: 0,
      model: 'scripted',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  },
})('scripted');

/** Stands in for a connected account: only U1 has one. */
const crmLookup = createTool({
  id: 'acme__crm_lookup',
  description: 'Look up a customer in the CRM.',
  inputSchema: z.object({ name: z.string() }),
  execute: async () => ({ found: false }),
});

let app: Awaited<ReturnType<typeof createHonoServer>>;
const resolvedFor: Array<string | undefined> = [];

beforeAll(async () => {
  const agent = new Agent({
    id: 'crm-agent',
    name: 'CRM Agent',
    instructions: 'Test agent.',
    model: scripted,
    tools: async (): Promise<Record<string, typeof crmLookup>> => {
      const who = currentOnBehalfOf();
      resolvedFor.push(who);
      return who === 'U1' ? { acme__crm_lookup: crmLookup } : {};
    },
  });
  const mastra = new Mastra({
    agents: { 'crm-agent': agent },
    server: { middleware: [agentAuthMiddleware] },
  });
  app = await createHonoServer(mastra, { tools: {} });
});

const turnAs = (subject: string) =>
  app.request('/api/a2a/crm-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agentbase-on-behalf-of': subject },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          role: 'user',
          messageId: crypto.randomUUID(),
          parts: [{ kind: 'text', text: `hello as ${subject}` }],
        },
      },
    }),
  });

describe('AGT-025 tools resolved per caller inside Mastra’s A2A server', () => {
  it('each concurrent turn is offered only the tools for the user it acts for', async () => {
    const [a, b] = await Promise.all([turnAs('U1'), turnAs('U2')]);
    expect((await a.json()).error).toBeUndefined();
    expect((await b.json()).error).toBeUndefined();

    const u1 = offered.filter((o) => o.subject === 'U1');
    const u2 = offered.filter((o) => o.subject === 'U2');
    expect(u1.length).toBeGreaterThan(0);
    expect(u2.length).toBeGreaterThan(0);
    for (const o of u1) expect(o.tools).toContain('acme__crm_lookup');
    for (const o of u2) expect(o.tools).not.toContain('acme__crm_lookup');
    expect(resolvedFor).toEqual(expect.arrayContaining(['U1', 'U2']));
  });

  it('the agent card, fetched with no caller, lists no user-only tool', async () => {
    const res = await app.request('/api/.well-known/crm-agent/agent-card.json');
    const card = (await res.json()) as { skills: Array<{ id: string }> };
    expect(card.skills.map((s) => s.id)).not.toContain('acme__crm_lookup');
  });
});
