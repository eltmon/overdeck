/**
 * PAN-4280 (WI-14, FR-1/FR-4/FR-5/FR-6) — browser coverage for "type and go":
 * a fresh profile stays in Simple mode across reloads, typing anywhere on the
 * page lands in the Home composer, and Enter starts a conversation with the
 * raw typed text and no project. Runs against a dashboard built from this
 * branch, in an isolated browser context per test (never a shared profile).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.OVERDECK_DASHBOARD_URL ?? 'http://127.0.0.1:3011';

test('fresh profile stays in simple mode across reloads', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="simple-home-page"]')).toBeVisible({ timeout: 15_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-component="simple-home-page"]')).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
});

test('typing without clicking lands in the composer', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const home = page.locator('[data-component="simple-home-page"]');
  await expect(home).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('h');
  await page.keyboard.press('e');
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  await page.keyboard.press('o');

  await expect(home.getByTestId('home-composer-input')).toHaveValue('hello');
});

test('Enter starts a conversation with the raw text and no project', async ({ page }) => {
  await page.route('**/api/registered-projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  let posted: { message?: string; projectKey?: string } | null = null;
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON() as typeof posted;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'type-and-go-e2e' }) });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const home = page.locator('[data-component="simple-home-page"]');
  const input = home.getByTestId('home-composer-input');
  await expect(input).toBeVisible({ timeout: 15_000 });

  await input.fill('hello');
  await input.press('Enter');

  await page.waitForURL('**/conv/type-and-go-e2e**', { timeout: 15_000 });
  expect(posted, 'composer never POSTed /api/conversations').not.toBeNull();
  expect(posted!.message).toBe('hello');
  expect(posted!.projectKey).toBeUndefined();
});
