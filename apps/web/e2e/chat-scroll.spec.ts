import { expect, test } from '@playwright/test';
import { signedIn } from './session';

/**
 * E2E-011: a long conversation scrolls inside the chat card. The page itself
 * does not grow, the message box stays on screen, and the newest answer is in
 * view while the first has scrolled out of it.
 */
test('a long conversation scrolls inside the card and the message box stays on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await signedIn(page);
  let n = 0;
  await page.route('**/api/a2a/example-agent', (route) => {
    n += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        text: `Answer ${n}. ${'A reply long enough to take a few lines in the card. '.repeat(4)}`,
        a2ui: [],
        via: 'direct',
        conversationId: 'c1',
      }),
    });
  });

  await page.goto('/');
  const box = page.getByPlaceholder('Type a message for the agent...');
  for (let i = 1; i <= 8; i++) {
    await box.fill(`Question ${i}`);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(`Answer ${i}.`)).toBeVisible();
  }

  const log = page.getByRole('log', { name: 'Conversation' });
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
  await expect(box).toBeInViewport();
  await expect(page.getByText('Answer 8.')).toBeInViewport();
  await expect(page.getByText('Answer 1.')).not.toBeInViewport();
});
