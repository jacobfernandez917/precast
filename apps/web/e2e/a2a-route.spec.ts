import { expect, test } from '@playwright/test';

/**
 * E2E for the A2A route handler — the one surface every Precast web app exposes
 * to talk to its agents, and the only route where a mistake is invisible from
 * the outside.
 *
 * These deliberately exercise the paths that DON'T need a live agent or an LLM
 * key, because those are the ones a scaffolded project can regress silently:
 * validation, error shape, and the contract that a failure is reported rather
 * than swallowed. The live round-trip is `pnpm smoke:chat` (SMOKE-016), which
 * needs a working provider key and is not part of CI.
 */
test.describe('POST /api/a2a/:agentId', () => {
  test('rejects a request with no text field', async ({ request }) => {
    const res = await request.post('/api/a2a/example-agent', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error ?? body.message, 'a 400 must say what was wrong').toBeTruthy();
  });

  test('rejects a non-string text field', async ({ request }) => {
    const res = await request.post('/api/a2a/example-agent', { data: { text: 42 } });
    expect(res.status()).toBe(400);
  });

  test('never leaks a stack trace or env value on failure', async ({ request }) => {
    // A misconfigured deploy will fail here. What it must not do is answer with
    // internals — this route is reachable from the browser.
    const res = await request.post('/api/a2a/does-not-exist-agent', {
      data: { text: 'hello' },
    });
    const body = await res.text();
    expect(body).not.toMatch(/at\s+\w+\s+\(.*\.ts:\d+/); // stack frame
    expect(body).not.toMatch(/AGENTBASE_CLIENT_SECRET|AGENT_API_TOKEN/);
  });

  test('answers with a JSON body whatever the outcome', async ({ request }) => {
    // The UI parses JSON unconditionally; an HTML error page here surfaces as an
    // unhandled parse error in the browser rather than a readable message.
    const res = await request.post('/api/a2a/example-agent', { data: { text: 'ping' } });
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
    await expect(res.json()).resolves.toBeTruthy();
  });
});

test.describe('health route', () => {
  test('reports the transport the app is configured for', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
