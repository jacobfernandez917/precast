import { expect, test, type Page, type Route } from '@playwright/test';
import { signedIn } from './session';

/**
 * E2E-005: A2UI cards in a real browser. The route handler is stubbed at the network layer, so
 * this needs no agent and no LLM key: it proves the renderer draws `raya.blocks.v1` through
 * `@a2ui/react` on Astryx, and that a press goes back to the route as `{ action }` on the same
 * conversation. The fixture is what `show_card` produces for a deploy card (SHR-003).
 */

const V = 'v0.9.1';
const card = [
  { version: V, createSurface: { surfaceId: 'card-1', catalogId: 'raya.blocks.v1' } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'card-1',
      components: [
        { id: 'root', component: 'Stack', children: ['title', 'body', 'note', 'rule', 'actions'] },
        { id: 'title', component: 'Header', text: 'Deploy failed' },
        {
          id: 'body',
          component: 'Section',
          text: 'Staging is still on the previous build.',
          fields: [
            { label: 'Commit', value: '4f21a9' },
            { label: 'Duration', value: '3m 12s' },
          ],
        },
        { id: 'note', component: 'Context', text: 'From the build pipeline' },
        { id: 'rule', component: 'Divider' },
        {
          id: 'button-0',
          component: 'Button',
          label: 'Retry deploy',
          variant: 'primary',
          action: { name: 'retry', value: '4f21a9' },
        },
        {
          id: 'button-1',
          component: 'Button',
          label: 'Open the log',
          url: 'https://example.com/log',
        },
        {
          id: 'choice',
          component: 'Select',
          action: { name: 'pick_env' },
          placeholder: 'Environment',
          options: [
            { label: 'Staging', value: 'staging' },
            { label: 'Production', value: 'prod' },
          ],
        },
        { id: 'actions', component: 'Actions', children: ['button-0', 'button-1', 'choice'] },
      ],
    },
  },
];

const reply = (text: string, a2ui: unknown[] = []) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, text, a2ui, via: 'direct', raw: {}, conversationId: 'c1' }),
});

/** Stub the agent route: the first turn answers with the card, later turns with plain text. */
async function stubAgent(page: Page, a2ui: unknown[]) {
  const posts: Array<Record<string, unknown>> = [];
  await page.route('**/api/a2a/example-agent', (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    return route.fulfill(posts.length === 1 ? reply('Done.', a2ui) : reply('Retrying.'));
  });
  return posts;
}

async function ask(page: Page, text: string) {
  await page.goto('/');
  await page.getByPlaceholder('Type a message for the agent...').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Done.')).toBeVisible();
}

test.describe('agent cards (A2UI)', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('draws the card the agent attached, on Astryx', async ({ page }) => {
    await stubAgent(page, card);
    await ask(page, '#card deploy status?');

    await expect(page.getByRole('heading', { name: 'Deploy failed' })).toBeVisible();
    await expect(page.getByText('Staging is still on the previous build.')).toBeVisible();
    await expect(page.getByText('Commit')).toBeVisible();
    await expect(page.getByText('4f21a9')).toBeVisible();
    await expect(page.getByText('From the build pipeline')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry deploy' })).toBeVisible();
    const log = page.getByRole('link', { name: 'Open the log' });
    await expect(log).toHaveAttribute('href', 'https://example.com/log');
    await expect(log).toHaveAttribute('rel', /noopener/);
  });

  test('a press goes back to the route as an action on the same conversation', async ({ page }) => {
    const posts = await stubAgent(page, card);
    await ask(page, '#card deploy status?');

    await page.getByRole('button', { name: 'Retry deploy' }).click();
    await expect(page.getByText('Retrying.')).toBeVisible();
    await expect(page.getByText('Pressed Retry deploy')).toBeVisible();

    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({
      conversationId: 'c1',
      action: {
        name: 'retry',
        value: '4f21a9',
        surfaceId: 'card-1',
        sourceComponentId: 'button-0',
        context: { value: '4f21a9', label: 'Retry deploy' },
      },
    });
    expect(posts[1]).not.toHaveProperty('text');
  });

  test('a reply with no card renders as text only', async ({ page }) => {
    await stubAgent(page, []);
    await ask(page, 'hello');
    await expect(page.getByRole('button', { name: 'Retry deploy' })).toHaveCount(0);
  });

  test('a component the catalog does not name is not drawn', async ({ page }) => {
    const offCatalog = [
      card[0],
      {
        version: V,
        updateComponents: {
          surfaceId: 'card-1',
          components: [
            { id: 'root', component: 'Stack', children: ['title', 'bad'] },
            { id: 'title', component: 'Header', text: 'Deploy failed' },
            { id: 'bad', component: 'Marquee', text: 'SHOULD NOT RENDER' },
          ],
        },
      },
    ];
    await stubAgent(page, offCatalog);
    await ask(page, '#card');
    await expect(page.getByText('SHOULD NOT RENDER')).toHaveCount(0);
  });
});
