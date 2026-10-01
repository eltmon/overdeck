/**
 * PAN-4445 — pair, list and revoke a device from Settings → Anywhere, and add
 * a trusted address, with no terminal step.
 *
 * Runs against an isolated dashboard (its own temp `OVERDECK_HOME` and port,
 * no Deacon) in fresh browser contexts, never the operator's live dashboard.
 * `npm run build` first — the fixture serves the built frontend from `dist`.
 *
 * The root context is a browser on this machine, so it holds the root session
 * (`overdeck_session`) and may create pairing links and add addresses. The
 * fixture's `http://127.0.0.1:<port>` origin is loopback and trusted by
 * default, so the journey uses the dialog's "Use this machine only" choice.
 *
 * The browser's TCP peer is loopback, which the remote request gate trusts, so
 * the post-revocation check uses `GET /api/devices`: that route checks the
 * credential itself, whatever the peer. A route such as `/api/issues` would
 * still answer 200.
 */

import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4445';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const CARD = '[data-component="anywhere-status-card"]';
const PANEL = '[data-component="anywhere-devices-panel"]';
const DIALOG = '[data-component="pair-device-dialog"]';

let dashboard: IsolatedDashboard;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeEach(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterEach(async () => {
  await dashboard?.stop();
});

async function openAnywhereSettings(page: Page): Promise<void> {
  await page.goto(`${dashboard.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 30_000 });
  // The Settings side nav is hidden at narrow widths, so scroll to the section.
  const section = page.locator('section#anywhere');
  await section.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await expect(section).toBeVisible();
}

test('pairs a device from Settings → Anywhere, lists it, and revokes it', async ({ browser }) => {
  const root = await browser.newContext();
  const device = await browser.newContext();
  try {
    const page = await root.newPage();
    await openAnywhereSettings(page);
    const card = page.locator(CARD).first();
    await expect(card.getByTestId('anywhere-paired-devices')).toHaveText('0', { timeout: 15_000 });
    await expect(page.locator(PANEL).getByText('No devices are paired yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Pair a device' }).click();
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Address the other device opens').selectOption({ value: '__local__' });
    await dialog.getByRole('button', { name: 'Create pairing link' }).click();

    const linkInput = dialog.getByLabel('Pairing link');
    await expect(linkInput).toHaveValue(/\/#pair=odp_/);
    await expect(dialog.getByAltText('Pairing QR code')).toBeVisible();
    await expect(dialog.getByText('Works only on this machine')).toBeVisible();
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/pair-dialog.png` });
    const link = await linkInput.inputValue();

    const devicePage = await device.newPage();
    const exchange = devicePage.waitForResponse((res) => res.url().endsWith('/api/pairing/exchange'));
    await devicePage.goto(link, { waitUntil: 'domcontentloaded' });
    expect((await exchange).status()).toBe(200);
    await expect(devicePage.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 30_000 });
    const cookies = await device.cookies();
    expect(cookies.some((c) => c.name === 'overdeck_device')).toBe(true);
    expect(cookies.some((c) => c.name === 'overdeck_session')).toBe(false);

    await expect(dialog.getByText(/^Paired: /)).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    const panel = page.locator(PANEL);
    const row = panel.locator('li').first();
    await expect(row.getByRole('button', { name: 'Revoke' })).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('anywhere-paired-devices')).toHaveText('1', { timeout: 10_000 });

    await row.getByRole('button', { name: 'Revoke' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Revoke' }).click();

    await expect(row.getByText(/^Revoked/)).toBeVisible({ timeout: 10_000 });
    const afterRevoke = await devicePage.request.get(`${dashboard.baseUrl}/api/devices`);
    expect(afterRevoke.status()).toBe(401);
    await expect(card.getByTestId('anywhere-paired-devices')).toHaveText('0', { timeout: 10_000 });
    await page.screenshot({ path: `${SHOT_DIR}/after-revoke.png` });
  } finally {
    await root.close();
    await device.close();
  }
});

test('adds a trusted address from the pair dialog without a restart', async ({ browser }) => {
  const root = await browser.newContext();
  try {
    const page = await root.newPage();
    await openAnywhereSettings(page);
    const card = page.locator(CARD).first();
    await expect(card.getByText('Only this machine')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Pair a device' }).click();
    const dialog = page.locator(DIALOG);
    await dialog.getByLabel('Address the other device opens').selectOption({ value: '__other__' });
    await dialog.getByLabel('Address', { exact: true }).fill('https://desk.example.test');
    await dialog.getByRole('button', { name: 'Add to trusted addresses' }).click();

    await expect(dialog.getByLabel('Address the other device opens')).toHaveValue('https://desk.example.test', { timeout: 10_000 });
    await expect(dialog.getByRole('button', { name: 'Create pairing link' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await expect(card.getByText('https://desk.example.test')).toBeVisible({ timeout: 10_000 });
    const status = await page.request.get(`${dashboard.baseUrl}/api/anywhere/status`);
    const body = await status.json() as { addresses: Array<{ origin: string; loopback: boolean }> };
    expect(body.addresses).toContainEqual({ origin: 'https://desk.example.test', loopback: false });
    await page.screenshot({ path: `${SHOT_DIR}/trusted-address.png` });
  } finally {
    await root.close();
  }
});
