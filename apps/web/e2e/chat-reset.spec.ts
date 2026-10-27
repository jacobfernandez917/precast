import { expect, test, type Page, type Route } from '@playwright/test';
import { signedIn } from './session';

/**
 * E2E-007: "Start over" while a turn is in flight. The route is stubbed and the
 * second turn's answer is held until after the reset, as an agent that keeps
 * working would deliver it. Whatever it carries (an answer, an error, a
 * conversation id) must not reach the new conversation, for a typed message and
 * for a card press alike, and the new conversation must not be left loading.
 */

const V = 'v0.9.1';
const card = [
  { version: V, createSurface: { surfaceId: 'card-1', catalogId: 'raya.blocks.v1' } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'card-1',
      components: [
        { id: 'root', component: 'Stack', children: ['title', 'actions'] },
        { id: 'title', component: 'Header', text: 'Deploy failed' },
        {
          id: 'button-0',
          component: 'Button',
          label: 'Retry deploy',
          variant: 'primary',
          action: { name: 'retry', value: '4f21a9' },
        },
        { id: 'actions', component: 'Actions', children: ['button-0'] },
      ],
    },
  },
];

const ok = (text: string, conversationId: string, a2ui: unknown[] = []) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, text, a2ui, via: 'direct', conversationId }),
});
const failed = (status: number, conversationId: string) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    ok: false,
    error: `The agent call failed (HTTP ${status}).`,
    status,
    via: 'direct',
    conversationId,
  }),
});

type Fulfil = Parameters<Route['fulfill']>[0];

/**
 * Turn 1 answers at once (so "Start over" appears), turn 2 waits for `release()`,
 * later turns answer at once. Returns the posted bodies.
 */
async function stub(page: Page, first: Fulfil, held: Fulfil, later: Fulfil) {
  const posts: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/a2a/example-agent', async (route) => {
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    const n = posts.length;
    if (n === 2) await gate;
    await route.fulfill(n === 1 ? first : n === 2 ? held : later);
  });
  return { posts, release };
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder('Type a message for the agent...').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/** Let the held answer reach the page and the page run whatever it does with it. */
async function deliverHeld(page: Page, release: () => void) {
  const delivered = page.waitForResponse(
    (r) => r.url().includes('/api/a2a/example-agent') && r.request().postDataJSON() !== null,
  );
  release();
  await delivered;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
}

async function startOverWhileWaiting(page: Page, posts: unknown[]) {
  await expect.poll(() => posts.length).toBe(2);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('First answer.')).toHaveCount(0);
}

test.describe('Start over while a turn is in flight', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('a typed message answered after the reset changes nothing', async ({ page }) => {
    const { posts, release } = await stub(
      page,
      ok('First answer.', 'c-old'),
      ok('Late answer.', 'c-old'),
      ok('Fresh answer.', 'c-new'),
    );
    await page.goto('/');
    await send(page, 'one');
    await expect(page.getByText('First answer.')).toBeVisible();
    await send(page, 'two');
    await startOverWhileWaiting(page, posts);

    await deliverHeld(page, release);
    await expect(page.getByText('Late answer.')).toHaveCount(0);
    await expect(page.getByText('Start over')).toHaveCount(0);

    await send(page, 'three');
    await expect(page.getByText('Fresh answer.')).toBeVisible();
    expect(posts[2], 'the new conversation must not continue the cleared one').not.toHaveProperty(
      'conversationId',
    );
  });

  test('a failure arriving after the reset shows no error and leaves nothing loading', async ({
    page,
  }) => {
    const { posts, release } = await stub(
      page,
      ok('First answer.', 'c-old'),
      failed(502, 'c-old'),
      ok('Fresh answer.', 'c-new'),
    );
    await page.goto('/');
    await send(page, 'one');
    await expect(page.getByText('First answer.')).toBeVisible();
    await send(page, 'two');
    await startOverWhileWaiting(page, posts);

    await deliverHeld(page, release);
    await expect(page.getByText(/HTTP 502/)).toHaveCount(0);

    await send(page, 'three');
    await expect(page.getByText('Fresh answer.')).toBeVisible();
    expect(posts[2]).not.toHaveProperty('conversationId');
  });

  test('a card press answered after the reset changes nothing', async ({ page }) => {
    const { posts, release } = await stub(
      page,
      ok('First answer.', 'c-old', card),
      ok('Retrying.', 'c-old'),
      ok('Fresh answer.', 'c-new'),
    );
    await page.goto('/');
    await send(page, '#card deploy status?');
    await expect(page.getByText('First answer.')).toBeVisible();
    await page.getByRole('button', { name: 'Retry deploy' }).click();
    await startOverWhileWaiting(page, posts);
    expect(posts[1]).toHaveProperty('action');

    await deliverHeld(page, release);
    await expect(page.getByText('Retrying.')).toHaveCount(0);
    await expect(page.getByText('Pressed Retry deploy')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Deploy failed' })).toHaveCount(0);

    await send(page, 'three');
    await expect(page.getByText('Fresh answer.')).toBeVisible();
    expect(posts[2]).not.toHaveProperty('conversationId');
  });

  test('without a reset, a failed turn keeps its conversation id for the retry', async ({
    page,
  }) => {
    const { posts, release } = await stub(
      page,
      ok('First answer.', 'c-old'),
      failed(503, 'c-old'),
      ok('Fresh answer.', 'c-old'),
    );
    await page.goto('/');
    await send(page, 'one');
    await expect(page.getByText('First answer.')).toBeVisible();
    await send(page, 'two');
    await expect.poll(() => posts.length).toBe(2);
    release();
    await expect(page.getByText('The agent call failed (HTTP 503).')).toBeVisible();

    await send(page, 'retry');
    await expect(page.getByText('Fresh answer.')).toBeVisible();
    expect(posts[2]).toMatchObject({ conversationId: 'c-old' });
  });
});
