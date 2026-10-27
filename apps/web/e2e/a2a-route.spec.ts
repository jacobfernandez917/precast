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
  // Sign-in is required before anything else is read; body validation is
  // covered by the route's unit tests, where a signed-in user is stubbed.
  for (const [name, data] of [
    ['no text field', {}],
    ['a non-string text field', { text: 42 }],
    ['a malformed card press', { action: 'retry' }],
    ['a well-formed message', { text: 'hello' }],
  ] as const) {
    test(`refuses ${name} from someone not signed in, with 401`, async ({ request }) => {
      const res = await request.post('/api/a2a/example-agent', { data });
      expect(res.status()).toBe(401);
      expect(res.headers()['content-type'] ?? '').toContain('application/json');
      expect((await res.json()).error).toBe('Sign in to chat with the agent.');
    });
  }

  test('never leaks a stack trace or env value on failure', async ({ request }) => {
    const res = await request.post('/api/a2a/does-not-exist-agent', {
      data: { text: 'hello' },
    });
    const body = await res.text();
    expect(body).not.toMatch(/at\s+\w+\s+\(.*\.ts:\d+/); // stack frame
    expect(body).not.toMatch(/AGENTBASE_CLIENT_SECRET|AGENT_API_TOKEN|BETTER_AUTH_SECRET/);
  });
});

test.describe('health route', () => {
  test('answers, and says why when the app cannot be used', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // This test server has no sign-in secret or database, so sign-in cannot
    // work and health says so instead of a misleading ok.
    expect(body.status).toBe(
      body.signIn === 'ready' || body.signIn === 'starting' ? 'ok' : 'degraded',
    );
    expect(body.signIn).not.toBe('ready');
  });
});
