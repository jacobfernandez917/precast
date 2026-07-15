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
