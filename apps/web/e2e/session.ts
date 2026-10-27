import type { Page } from '@playwright/test';

/**
 * Sign the page in for a browser test. Chat is shown only to a signed-in
 * person, and these tests stub the agent route, so they stub the session the
 * same way: Better Auth's client reads it from /api/auth/get-session.
 */
export async function signedIn(page: Page, email = 'tester@example.com'): Promise<void> {
  await page.route('**/api/auth/get-session*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          id: 's1',
          userId: 'u1',
          token: 't',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        user: {
          id: 'u1',
          email,
          name: 'Tester',
          emailVerified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    }),
  );
}
