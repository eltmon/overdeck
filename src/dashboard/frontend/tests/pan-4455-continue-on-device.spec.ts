/**
 * PAN-4455 — "Continue on another device" from the conversation itself: the
 * header ⋮ menu opens the dialog, the screen tab adds a reachable address,
 * shows the plain `<address>/conv/<id>` link, then mints a pairing link that
 * pairs a fresh browser and lands it on the conversation with an empty
 * fragment.
 *
 * Runs against an isolated dashboard (its own temp `OVERDECK_HOME` and port,
 * no Deacon) in fresh browser contexts, never the operator's live dashboard
 * (NFR-5). `npm run build` first — the fixture serves the built frontend from
 * `dist`.
 *
 * `desk.example.test` is never resolved: the device context opens the link's
 * path and fragment on the fixture's loopback origin, which is what a phone
 * would reach through that address.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createConversation } from '../../../lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4455';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const DIALOG = '[data-component="continue-on-device-dialog"]';
const TITLE = 'PAN-4455 demo';

let dashboard: IsolatedDashboard | undefined;

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test.afterEach(async () => {
  await dashboard?.stop();
  dashboard = undefined;
});

/** Seed one managed conversation into the temp home before the server opens it. */
function seedConversation(home: string): void {
  const saved = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  try {
    createConversation({ name: 'pan-4455-demo', tmuxSession: 'conv-pan-4455-demo', cwd: home, harness: 'claude-code', title: TITLE, workspaceId: null });
  } finally {
    closeOverdeckDatabase();
    if (saved === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = saved;
  }
}

test('the dialog link pairs a fresh browser and opens the conversation', async ({ browser }) => {
  const home = mkdtempSync(join(tmpdir(), 'pan-4455-'));
  seedConversation(home);
  dashboard = await startIsolatedDashboard({ home });
  const baseUrl = dashboard.baseUrl;

  const root = await browser.newContext();
  const device = await browser.newContext();
  try {
    const page = await root.newPage();
    const listed = await page.request.get(`${baseUrl}/api/conversations`);
    const conversations = await listed.json() as Array<{ id: number; name: string }> | { conversations: Array<{ id: number; name: string }> };
    const rows = Array.isArray(conversations) ? conversations : conversations.conversations;
    const id = rows.find((row) => row.name === 'pan-4455-demo')?.id;
    expect(id, 'the seeded conversation is listed').toBeDefined();

    await page.goto(`${baseUrl}/conv/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 30_000 });
    await page.getByLabel('More conversation actions').click();
    await page.getByRole('menuitem', { name: 'Continue on another device' }).click();

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Open on another screen' })).toHaveAttribute('aria-selected', 'true');

    await dialog.getByLabel('Address', { exact: true }).fill('https://desk.example.test');
    await dialog.getByRole('button', { name: 'Add an address' }).click();
    await expect(dialog.getByLabel('Address the other device opens')).toHaveValue('https://desk.example.test', { timeout: 10_000 });

    const linkInput = dialog.getByTestId('continue-link');
    await expect(linkInput).toHaveValue(`https://desk.example.test/conv/${id}`);
    await expect(dialog.getByAltText('Conversation QR code')).toBeVisible();
    await expect(dialog.getByLabel('Also pair the device')).toBeChecked();
    await dialog.getByRole('button', { name: 'Create pairing link' }).click();
    await expect(linkInput).toHaveValue(new RegExp(`^https://desk\\.example\\.test/conv/${id}#pair=odp_`));
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/continue-dialog.png` });
    const link = await linkInput.inputValue();

    const devicePage = await device.newPage();
    const target = new URL(link);
    const exchange = devicePage.waitForResponse((res) => res.url().endsWith('/api/pairing/exchange'));
    await devicePage.goto(`${baseUrl}${target.pathname}${target.hash}`, { waitUntil: 'domcontentloaded' });
    expect((await exchange).status()).toBe(200);
    await expect(devicePage.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => new URL(devicePage.url()).hash).toBe('');
    await expect.poll(() => new URL(devicePage.url()).pathname).toBe(`/conv/${id}`);
    await expect(devicePage.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
    await devicePage.screenshot({ path: `${SHOT_DIR}/device-conversation.png` });

    const devices = await page.request.get(`${baseUrl}/api/devices`);
    const body = await devices.json() as { devices: Array<{ revokedAt: string | null }> };
    expect(body.devices.filter((d) => !d.revokedAt)).toHaveLength(1);
  } finally {
    await root.close();
    await device.close();
  }
});
