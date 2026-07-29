import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 45001);
const HOST = process.env.E2E_HOST ?? '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

// Autonomous UI tests: Playwright builds and boots the Next dev server itself,
// so `pnpm test:e2e` needs no manually-started app. CI reuses an already-running
// server if one is present.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `next dev` boots the full app (SSR + route handlers) with no pre-build,
    // so `pnpm test:e2e` is self-contained.
    command: `next dev -p ${PORT} -H ${HOST}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
