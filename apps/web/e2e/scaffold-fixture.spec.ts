import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../docs/fixtures/scaffold-project-ideas.json', import.meta.url),
    'utf8',
  ),
);
const trial = fixtures.find(
  (x: { case: number }) => x.case === Number(process.env.SCAFFOLD_E2E_CASE),
);
const baseURL = process.env.PRD_E2E_BASE_URL;
test.skip(!baseURL || !trial, 'Needs an actual generated public project and its fixture case.');
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function createAccount(page: Page) {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: /Create an account/i })).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: /Create an account/i }).click();
    if (await page.getByRole('textbox', { name: 'Name', exact: true }).isVisible()) break;
    await page.waitForTimeout(300);
  }
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Scaffold Regression');
  await page
    .getByRole('textbox', { name: /^Email/ })
    .fill('precast-' + randomUUID() + '@example.invalid');
  await page.getByLabel(/^Password/).fill(randomUUID() + randomUUID());
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
}
test('E2E-019 fixture-specific public app, every collection, account isolation and real streamed model', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(360000);
  const reportDir = process.env.PRD_E2E_REPORT_DIR ?? testInfo.outputDir;
  mkdirSync(reportDir, { recursive: true });
  const evidence: Record<string, unknown> = {
    case: trial.case,
    idea: trial.idea,
    startedAt: new Date().toISOString(),
    url: baseURL,
    collections: [],
  };
  const origin = new URL(baseURL!).origin;
  const jsonHeaders = { origin };
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: trial.blueprint.title, exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute(
    'data-apc-theme',
    trial.scenario === 'override' ? 'nova' : trial.theme,
  );
  await expect(page).toHaveTitle(trial.blueprint.title);
  evidence.selectedThemeVerified = true;
  for (const p of ['/.env', '/.precast/prd-build.json', '/api/agents', '/.git/config'])
    expect((await request.get(p)).status()).toBe(404);
  for (const collection of trial.blueprint.collections)
    expect((await request.get('/api/project-records?collection=' + collection.id)).status()).toBe(
      401,
    );
  await createAccount(page);
  const other = await browser.newContext({ baseURL });
  try {
    await createAccount(await other.newPage());
    for (const collection of trial.blueprint.collections) {
      await page
        .getByRole('navigation', { name: 'Collections' })
        .getByRole('button', { name: collection.label, exact: true })
        .click();
      const textField = collection.fields.find((f: { type: string }) => f.type === 'text');
      expect(textField).toBeTruthy();
      const marker =
        'Probe ' + randomUUID() + ' — café 日本語 <img src=x onerror=globalThis.__fixtureXss=1>';
      const data: Record<string, string | boolean | number> = {};
      for (const field of collection.fields) {
        if (field.type === 'text') {
          data[field.id] = field.id === textField.id ? marker : 'Notes café ' + marker.slice(0, 20);
          await page
            .getByRole('textbox', { name: new RegExp('^' + escaped(field.label) + '(?:\\s|$)') })
            .fill(String(data[field.id]));
        } else if (field.type === 'choice') {
          data[field.id] = field.choices[0];
          await page
            .getByRole('combobox', { name: field.label, exact: true })
            .selectOption(field.choices[0]);
        } else if (field.type === 'number') {
          data[field.id] = 0;
          await page.getByRole('spinbutton', { name: field.label, exact: true }).fill('0');
        } else if (field.type === 'date') {
          data[field.id] = '2026-11-14';
          await page.getByLabel(field.label, { exact: true }).fill('2026-11-14');
        } else {
          data[field.id] = false;
          await page.getByRole('checkbox', { name: field.label, exact: true }).uncheck();
        }
      }
      await page
        .getByRole('button', { name: 'Add ' + collection.singular.toLowerCase(), exact: true })
        .click();
      const card = page.locator('article').filter({ hasText: marker });
      await expect(card).toBeVisible();
      expect(
        await page.evaluate(() => (globalThis as Record<string, unknown>).__fixtureXss),
      ).toBeUndefined();
      const listed = await (
        await page.request.get('/api/project-records?collection=' + collection.id)
      ).json();
      const record = listed.records.find(
        (r: { data: Record<string, unknown> }) => r.data[textField.id] === marker,
      );
      expect(record).toBeTruthy();
      expect(record.data).toEqual(data);
      for (const field of collection.fields) {
        const bad =
          field.type === 'date'
            ? '2026-02-30'
            : field.type === 'choice'
              ? 'NOT_AN_ALLOWED_CHOICE'
              : field.type === 'number'
                ? 'not-a-number'
                : field.type === 'boolean'
                  ? 'false'
                  : field.required
                    ? ''
                    : undefined;
        if (bad !== undefined)
          expect(
            (
              await page.request.post('/api/project-records', {
                headers: jsonHeaders,
                data: { collection: collection.id, data: { ...data, [field.id]: bad } },
              })
            ).status(),
          ).toBe(400);
      }
      expect(
        (
          await page.request.post('/api/project-records', {
            headers: { origin: 'https://outside.example.invalid' },
            data: { collection: collection.id, data },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await page.request.post('/api/project-records', {
            headers: jsonHeaders,
            data: { collection: collection.id, owner: 'someone-else', data },
          })
        ).status(),
      ).toBe(400);
      const foreign = await (
        await other.request.get('/api/project-records?collection=' + collection.id)
      ).json();
      expect(foreign.records).toEqual([]);
      expect(
        (
          await other.request.patch('/api/project-records', {
            headers: jsonHeaders,
            data: { collection: collection.id, id: record.id, data },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await other.request.delete('/api/project-records', {
            headers: jsonHeaders,
            data: { collection: collection.id, id: record.id },
          })
        ).status(),
      ).toBe(404);
      await card
        .getByRole('button', { name: 'Edit ' + collection.singular.toLowerCase(), exact: true })
        .click();
      const edited = marker + ' edited';
      await page
        .getByRole('textbox', { name: new RegExp('^' + escaped(textField.label) + '(?:\\s|$)') })
        .fill(edited);
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.locator('article').filter({ hasText: edited })).toBeVisible();
      await page.reload();
      await page
        .getByRole('navigation', { name: 'Collections' })
        .getByRole('button', { name: collection.label, exact: true })
        .click();
      await expect(page.locator('article').filter({ hasText: edited })).toBeVisible();
      await page
        .getByRole('textbox', { name: 'Search ' + collection.label.toLowerCase(), exact: true })
        .fill(edited);
      await expect(page.locator('article')).toHaveCount(1);
      await page
        .getByRole('textbox', { name: 'Search ' + collection.label.toLowerCase(), exact: true })
        .fill('No record can contain ' + randomUUID());
      await expect(page.locator('article')).toHaveCount(0);
      await page
        .getByRole('textbox', { name: 'Search ' + collection.label.toLowerCase(), exact: true })
        .fill('');
      await page
        .locator('article')
        .filter({ hasText: edited })
        .getByRole('button', { name: 'Delete ' + collection.singular.toLowerCase(), exact: true })
        .click();
      await expect(page.locator('article').filter({ hasText: edited })).toHaveCount(0);
      expect(
        (
          await (await page.request.get('/api/project-records?collection=' + collection.id)).json()
        ).records.some((r: { id: string }) => r.id === record.id),
      ).toBe(false);
      (evidence.collections as unknown[]).push({
        id: collection.id,
        fieldContract: true,
        crudReloadSearch: true,
        zeroFalseUnicode: true,
        xssEscaped: true,
        crossAccountIsolation: true,
        invalidValuesRefused: true,
      });
    }
    const marker = 'REAL_GEMINI_' + randomUUID().replaceAll('-', '');
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Use the example tool to echo exactly ' + marker + '.');
    const answer = page.waitForResponse(
      (r) => r.url().endsWith('/api/a2a/example-agent') && r.request().method() === 'POST',
    );
    const start = Date.now();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const response = await answer;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/event-stream');
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 180000 });
    evidence.modelUi = {
      realConnectedGemini: true,
      streamedResponse: true,
      durationMs: Date.now() - start,
    };
    await page.screenshot({
      path: join(reportDir, 'public-case-' + trial.case + '.png'),
      fullPage: true,
    });
    evidence.status = 'passed';
    evidence.endedAt = new Date().toISOString();
    writeFileSync(
      join(reportDir, 'public-case-' + trial.case + '.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 },
    );
  } finally {
    await other.close();
  }
});
