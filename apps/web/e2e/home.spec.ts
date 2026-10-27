import { expect, test } from '@playwright/test';
import { signedIn } from './session';

test.describe('home page', () => {
  test('renders the app heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Precast');
  });

  // E2E-009: chat is for signed-in people only. Signed out, the page offers
  // sign-in and no message box; the route refuses anonymous turns as well.
  test('signed out, it asks you to sign in and shows no chat', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Sign in to chat with your agent' }),
    ).toBeVisible();
    await expect(page.getByPlaceholder('Type a message for the agent...')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('signed in, it shows who you are and the chat', async ({ page }) => {
    await signedIn(page, 'jamie@example.com');
    await page.goto('/');
    await expect(page.getByText('Signed in as jamie@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('Type a message for the agent...')).toBeVisible();
  });

  // The page used to fetch its own /api/health through the request's Host
  // header, which let a forged Host make the server request any address.
  test('no longer shows a server health card', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Server health')).toHaveCount(0);
  });

  test('exposes the health API route directly, with sign-in readiness', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(['ok', 'degraded']).toContain(body.status);
    expect(typeof body.signIn).toBe('string');
  });

  // E2E-010: what every response carries.
  test('sends the security headers and no framework banner', async ({ request }) => {
    const res = await request.get('/');
    const headers = res.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
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
