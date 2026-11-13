import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PRD_E2E_BASE_URL, 'Run against the real PRD-built Action Desk preview.');

async function createAccount(page: Page) {
  await page.goto('/sign-in');
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.getByRole('button', { name: /Create an account/i }).click();
    try {
      await page
        .getByRole('textbox', { name: 'Name', exact: true })
        .waitFor({ state: 'visible', timeout: 1000 });
      break;
    } catch {
      if (attempt === 9) throw new Error('The create-account form did not become interactive.');
    }
  }
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('PRD Verification');
  await page.getByRole('textbox', { name: /^Email/ }).fill(`prd-${randomUUID()}@example.invalid`);
  await page.getByLabel(/^Password/).fill(randomUUID() + randomUUID());
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

test('E2E-018 PDF-derived product, persistent CRUD, account isolation and real streamed assistant', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Action Desk', exact: true })).toBeVisible();
  expect((await request.get('/api/project-records?collection=actions')).status()).toBe(401);
  for (const path of ['/.env', '/.precast/prd-build.json', '/api/agents'])
    expect((await request.get(path)).status()).toBe(404);
  await createAccount(page);
  const title = `Follow up ${randomUUID()}`;
  await page.getByRole('textbox', { name: /^Title/ }).fill(title);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Open');
  await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('Normal');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  let card = page.locator('article').filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Edit action', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Done');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(card.getByText('Done', { exact: true })).toBeVisible();
  await page.reload();
  card = page.locator('article').filter({ hasText: title });
  await expect(card.getByText('Done', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search actions', exact: true }).fill(title);
  await expect(page.locator('article')).toHaveCount(1);
  const data = await (await page.request.get('/api/project-records?collection=actions')).json();
  const record = data.records.find((r: { data: { title: string } }) => r.data.title === title);
  expect(record.id).toBeTruthy();

  const other = await browser.newContext({ baseURL: process.env.PRD_E2E_BASE_URL });
  try {
    const otherPage = await other.newPage();
    await createAccount(otherPage);
    const listed = await (
      await other.request.get('/api/project-records?collection=actions')
    ).json();
    expect(listed.records).toEqual([]);
    const origin = new URL(process.env.PRD_E2E_BASE_URL!).origin;
    const tamper = await other.request.patch('/api/project-records', {
      headers: { origin },
      data: { collection: 'actions', id: record.id, data: record.data },
    });
    expect(tamper.status()).toBe(404);
    expect(
      (
        await other.request.delete('/api/project-records', {
          headers: { origin },
          data: { collection: 'actions', id: record.id },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
  await page.reload();
  await expect(page.locator('article').filter({ hasText: title })).toBeVisible();
  const marker = `PRD_LIVE_${randomUUID().replaceAll('-', '')}`;
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill(`Use the example tool to echo exactly ${marker}.`);
  const reply = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/a2a/example-agent') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await reply;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/event-stream');
  await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 180_000 });
  await page
    .locator('article')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Delete action', exact: true })
    .click();
  await expect(page.locator('article').filter({ hasText: title })).toHaveCount(0);
  await page.screenshot({
    path: process.env.PRD_E2E_SCREENSHOT ?? 'test-results/prd-workspace.png',
    fullPage: true,
  });
});
