#!/usr/bin/env node
/**
 * SMOKE-016 — the end-to-end chat round trip.
 *
 * This is the one claim the boilerplate could never substantiate: discovery,
 * transport, memory wiring and env validation are each unit-tested, but nothing
 * has ever sent a real message through the whole stack and read the reply. That
 * gap is invisible precisely because every individual piece is green.
 *
 * It is a script rather than a test because it needs things CI does not have: a
 * running agents container and a working provider key. It fails loudly and
 * specifically when either is missing — "no LLM key" and "container not running"
 * are different problems with different fixes, and collapsing them into one
 * "smoke failed" is what makes this kind of check useless.
 *
 *   pnpm smoke:chat                      # default agent, default URL
 *   pnpm smoke:chat --agent summary-agent
 *   pnpm smoke:chat --url http://localhost:45000
 */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = (flag('url', process.env.MASTRA_INTERNAL_URL || 'http://localhost:45000')).replace(
  /\/+$/,
  '',
);
const agentId = flag('agent', 'example-agent');
const prompt = flag('text', 'Reply with exactly the word: pong');
const token = process.env.AGENT_API_TOKEN;

const LLM_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'AGENTBASE_CLIENT_ID',
];
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (!LLM_KEYS.some((k) => process.env[k])) {
  fail(
    'No LLM provider is configured, so a chat round trip cannot succeed.\n' +
      `  Set one of: ${LLM_KEYS.join(', ')} in .env.\n` +
      '  This is a real gap, not a skip — the round trip stays unproven until it runs.',
  );
}

console.log(`→ ${base}/api/a2a/${agentId}`);

let res;
try {
  res = await fetch(`${base}/api/a2a/${agentId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `smoke-${process.pid}`,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          role: 'user',
          messageId: `smoke-${process.pid}`,
          parts: [{ kind: 'text', text: prompt }],
        },
      },
    }),
  });
} catch (err) {
  fail(
    `Could not reach the agents API at ${base}.\n` +
      `  ${err?.message ?? err}\n` +
      '  Start the stack with `pnpm poc` (or `pnpm dev:agents`) and try again.',
  );
}

if (res.status === 401) {
  fail(
    'The agents API rejected the request (401).\n' +
      '  AGENT_API_TOKEN is set on the server but not in this shell, or they disagree.',
  );
}
if (!res.ok) fail(`Agents API returned HTTP ${res.status} ${res.statusText}.`);

const body = await res.json();
if (body.error) {
  fail(`The agent returned a JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`);
}

// A2A replies nest the text in parts[]; walk defensively rather than assuming a
// shape, so a protocol change reports "no text" instead of throwing.
const parts = body?.result?.parts ?? body?.result?.message?.parts ?? [];
const text = parts
  .filter((p) => p?.kind === 'text' && typeof p.text === 'string')
  .map((p) => p.text)
  .join('')
  .trim();

if (!text) {
  console.error(JSON.stringify(body, null, 2).slice(0, 800));
  fail('The agent answered, but with no text part. The transport works; the model did not reply.');
}

console.log(`← ${text.slice(0, 300)}`);
console.log('\n✔ Chat round trip verified end to end.');
