import { expect, test } from '@playwright/test';

test.describe('home page', () => {
  test('renders the app heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Precast');
  });

  test('shows server health fetched from the route handler', async ({ page }) => {
    await page.goto('/');
    const card = page.getByText('Server health');
    await expect(card).toBeVisible();
    // The server component fetches /api/health and renders the JSON payload.
    await expect(page.locator('pre')).toContainText('"status": "ok"');
  });

  test('exposes the health API route directly', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});


/**
 * Error boundaries. Without these files Next serves its own default pages —
 * unstyled, off-theme, and in production reduced to "Application error: a
 * client-side exception has occurred", which tells a user nothing.
 *
 * Only the 404 is asserted end to end: forcing a render-time throw to exercise
 * error.tsx would mean shipping a route that exists solely to crash, which is a
 * worse trade than leaving that boundary covered by typecheck and review.
 */
test.describe('error boundaries', () => {
  test('an unknown route renders the app 404, not the Next default', async ({ page }) => {
    const res = await page.goto('/definitely-not-a-real-route');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await expect(page.getByRole('link', { name: /home page/i })).toBeVisible();
  });
});
