/**
 * Session Vault from the dashboard alone: set up, sync, and join a second
 * machine (PAN-4446 WI-10, NFR-6).
 *
 * `npm run build` first: the fixture serves the *built* frontend out of `dist`
 * and runs the *built* server.
 *
 * No CLI call anywhere: machine A sets up a vault on an empty bare git remote
 * through Settings → Session Vault, writes down the shown-once recovery phrase
 * and generated passphrase, and syncs; machine B joins the same remote with
 * that passphrase and sees both machines. Each machine is its own isolated
 * dashboard with a throwaway `OVERDECK_HOME` and a throwaway `HOME` (so the
 * vault's settle poller never reads the operator's real transcripts), in its
 * own browser context. `OVERDECK_VAULT_IN_PEER=1` starts the vault service in
 * these peer dashboards, which "Sync now" needs (D-6).
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const SHOT_DIR = 'test-results/pan-4446';

let root: string;
let remote: string;
let dashboards: IsolatedDashboard[] = [];

test.setTimeout(240_000);

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pan-4446-e2e-'));
  remote = join(root, 'remote.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', remote]);
  for (const dir of ['homeA', 'homeB', 'userA', 'userB']) mkdirSync(join(root, dir));
  dashboards = [];
});

test.afterEach(async () => {
  for (const dashboard of dashboards) await dashboard.stop();
  rmSync(root, { recursive: true, force: true });
});

async function startMachine(name: 'A' | 'B'): Promise<IsolatedDashboard> {
  const dashboard = await startIsolatedDashboard({
    home: join(root, `home${name}`),
    env: { HOME: join(root, `user${name}`), OVERDECK_VAULT_IN_PEER: '1' },
  });
  dashboards.push(dashboard);
  return dashboard;
}

test('a vault is set up, synced and joined from the dashboard alone', async ({ browser }) => {
  mkdirSync(SHOT_DIR, { recursive: true });

  // Machine A: set up a new vault with a suggested passphrase.
  const machineA = await startMachine('A');
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto(`${machineA.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  const sectionA = pageA.locator('#session-vault');
  await sectionA.scrollIntoViewIfNeeded();
  await expect(sectionA.getByText('Set up a new vault')).toBeVisible({ timeout: 20_000 });

  await sectionA.getByLabel('Git URL').first().fill(remote);
  await expect(sectionA.getByLabel('Suggested (generated for you)')).toBeChecked();
  await sectionA.getByRole('button', { name: 'Set up vault' }).click();

  const phraseBox = pageA.getByTestId('vault-recovery-phrase');
  await expect(phraseBox).toBeVisible({ timeout: 60_000 });
  const phrase = (await phraseBox.inputValue()).trim();
  expect(phrase.split(/\s+/)).toHaveLength(24);
  const passphrase = (await pageA.getByTestId('vault-generated-passphrase').inputValue()).trim();
  expect(passphrase.split(/\s+/)).toHaveLength(6);

  const done = pageA.getByRole('button', { name: 'Done' });
  await expect(done).toBeDisabled();
  await pageA.getByLabel('I wrote it down').check();
  await done.click();
  await expect(pageA.getByRole('dialog')).toHaveCount(0);
  expect(await pageA.content()).not.toContain(phrase);

  // Machine A: Sync now records a last sync time.
  const syncA = sectionA.getByRole('button', { name: 'Sync now' });
  await expect(syncA).toBeVisible({ timeout: 20_000 });
  await syncA.click();
  await expect(sectionA.getByTestId('vault-last-sync')).toBeVisible({ timeout: 20_000 });
  await pageA.screenshot({ path: `${SHOT_DIR}/a-synced.png`, fullPage: true });
  await contextA.close();
  await machineA.stop();
  dashboards = dashboards.filter((dashboard) => dashboard !== machineA);

  // Machine B: join the same remote with the passphrase.
  const machineB = await startMachine('B');
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(`${machineB.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  const sectionB = pageB.locator('#session-vault');
  await sectionB.scrollIntoViewIfNeeded();
  await expect(sectionB.getByText('Join an existing vault')).toBeVisible({ timeout: 20_000 });

  await sectionB.getByLabel('Git URL').last().fill(remote);
  await sectionB.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await sectionB.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(sectionB.getByText(/^Joined as /)).toBeVisible({ timeout: 60_000 });

  const syncB = sectionB.getByRole('button', { name: 'Sync now' });
  await expect(syncB).toBeVisible({ timeout: 20_000 });
  await syncB.click();
  const machineRows = sectionB.locator('table').first().locator('tr');
  await expect(machineRows).toHaveCount(2, { timeout: 20_000 });
  await expect(sectionB.getByText('(this machine)')).toHaveCount(1);
  await pageB.screenshot({ path: `${SHOT_DIR}/b-joined.png`, fullPage: true });
  await contextB.close();
});
