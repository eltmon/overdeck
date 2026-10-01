/**
 * Settings -> Session Vault, isolated dashboard (PAN-4307 WI-8, AC-14).
 *
 * `npm run build` first: the fixture runs the *built* CLI (`dist/cli/index.js`)
 * and serves the *built* frontend out of `dist`.
 *
 * The fixture is a peer dashboard (`startIsolatedDashboard` sets
 * `OVERDECK_DISABLE_DEACON=1`), so the background vault service never starts
 * here (NFR-4) — the panel must still read the real on-disk vault state
 * through the routes alone, and shows "Background sync runs only in the
 * primary dashboard."
 *
 * Setup goes through the real built CLI, never a direct engine call, so this
 * exercises the same `pan vault setup`/`save`/`sync` path an operator would
 * use: a `dir:` backend (no network), two fixture transcripts saved and
 * quiet for 2h (past `liveQuietMinutes`), `evict: true`, then one sync to
 * populate the pending-deletion batch. T2's batch entry is then edited to
 * `verification: 'failed'` so both list states render before the delete.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const CLI = join(REPO_ROOT, 'dist/cli/index.js');
const SHOT_DIR = 'test-results/pan-4307';
const HOUR_MS = 60 * 60 * 1000;

function claudeLine(session: string, text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

async function runVault(home: string, ...args: string[]): Promise<void> {
  await execFileAsync('node', [CLI, 'vault', ...args], { env: { ...process.env, OVERDECK_HOME: home } });
}

let dashboard: IsolatedDashboard;
let home: string;
let vaultDir: string;
let t1Path: string;
let t2Path: string;

test.setTimeout(120_000);

test.beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'pan-4307-e2e-home-'));
  vaultDir = mkdtempSync(join(tmpdir(), 'pan-4307-e2e-vault-'));
  const cwd = join(home, 'fixture-repo');
  mkdirSync(cwd, { recursive: true });

  const session1 = 'aaaaaaaa-1111-4000-8000-000000000001';
  const session2 = 'bbbbbbbb-2222-4000-8000-000000000002';
  t1Path = join(home, `${session1}.jsonl`);
  t2Path = join(home, `${session2}.jsonl`);
  writeFileSync(t1Path, `${claudeLine(session1, 'T1 fixture transcript', cwd)}\n`);
  writeFileSync(t2Path, `${claudeLine(session2, 'T2 fixture transcript', cwd)}\n`);
  const quiet = new Date(Date.now() - 2 * HOUR_MS);
  utimesSync(t1Path, quiet, quiet);
  utimesSync(t2Path, quiet, quiet);

  await runVault(home, 'setup', `dir:${vaultDir}`, '--no-passphrase');
  await runVault(home, 'save', t1Path);
  await runVault(home, 'save', t2Path);

  const configPath = join(home, 'vault', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  config.evict = true;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  await runVault(home, 'sync');

  const batchPath = join(home, 'vault', 'eviction-batch.json');
  const batch = JSON.parse(readFileSync(batchPath, 'utf8')) as { entries: Array<{ nativePath: string; verification: string; reason?: string }> };
  const t2Entry = batch.entries.find((entry) => entry.nativePath === t2Path);
  if (!t2Entry) throw new Error(`fixture setup: T2 (${t2Path}) is not in the eviction batch after sync`);
  t2Entry.verification = 'failed';
  t2Entry.reason = 'fixture: forced failure';
  writeFileSync(batchPath, `${JSON.stringify(batch, null, 2)}\n`);

  dashboard = await startIsolatedDashboard({ home });
});

test.afterEach(async () => {
  await dashboard?.stop();
});

test('Settings -> Session Vault shows the pending batch and deletes only the verified entry', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });

  await page.goto(`${dashboard.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  await page.locator('#session-vault').scrollIntoViewIfNeeded();

  const section = page.locator('#session-vault');
  await expect(section.getByText('Background sync runs only in the primary dashboard.')).toBeVisible({ timeout: 20_000 });

  await expect(section.getByText(t1Path)).toBeVisible();
  await expect(section.getByText(t2Path)).toBeVisible();
  await expect(section.getByText('verified', { exact: true })).toBeVisible();
  await expect(section.getByText('failed: fixture: forced failure')).toBeVisible();

  const deleteButton = section.getByRole('button', { name: /Yes, delete these \(1 files, / });
  await expect(deleteButton).toBeVisible();
  expect(existsSync(t1Path)).toBe(true);
  expect(existsSync(t2Path)).toBe(true);

  await page.screenshot({ path: `${SHOT_DIR}/session-vault-before.png`, fullPage: true });

  await deleteButton.click();
  await expect(section.getByText(t1Path)).toHaveCount(0, { timeout: 20_000 });

  expect(existsSync(t1Path)).toBe(false);
  expect(existsSync(t2Path)).toBe(true);
  await expect(section.getByText(t2Path)).toBeVisible();

  await page.screenshot({ path: `${SHOT_DIR}/session-vault-after.png`, fullPage: true });
});
