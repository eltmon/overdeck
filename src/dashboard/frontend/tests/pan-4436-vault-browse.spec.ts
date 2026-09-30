/**
 * PAN-4436 — Session Vault browse copies, end to end.
 *
 * Machine A (a temp OVERDECK_HOME labelled `uat-laptop-a`) saves one Claude
 * transcript to a `dir:` vault; machine B joins the same vault. An isolated
 * dashboard on B's home (its own port, no Deacon) runs the vault sync with
 * OVERDECK_VAULT_IN_PEER=1, so A's conversation appears as a read-only browse
 * copy: `from uat-laptop-a` on the row, the full transcript in the panel, the
 * `pan vault resume <vaultId>` notice in place of the composer, and no Resume
 * control. `npm run build` first — the fixture serves `dist` and the CLI runs
 * from `dist/cli/index.js`.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CLI = join(REPO_ROOT, 'dist/cli/index.js');
const SHOT_DIR = 'test-results/pan-4436';
const OWNER_LABEL = 'uat-laptop-a';

let dashboard: IsolatedDashboard | undefined;
let dirs: string[] = [];
let vaultId = '';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

async function pan(home: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, OVERDECK_HOME: home },
    timeout: 60_000,
  });
  return stdout;
}

test.beforeEach(async () => {
  const [homeA, homeB, vaultDir, fixtureDir] = ['a', 'b', 'vault', 'fixture'].map((name) => mkdtempSync(join(tmpdir(), `pan-4436-${name}-`)));
  dirs = [homeA, homeB, vaultDir, fixtureDir];

  writeFileSync(join(homeA, 'environment-id.json'), JSON.stringify({
    v: 1, environmentId: randomUUID(), label: OWNER_LABEL, createdAt: new Date().toISOString(),
  }));

  const sessionId = randomUUID();
  const cwd = join(fixtureDir, 'uat-project');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(fixtureDir, '.claude', 'projects', '-uat', `${sessionId}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', sessionId, cwd, message: { role: 'user', content: 'UAT browse fixture question' }, uuid: 'u1', timestamp: now }),
    JSON.stringify({
      type: 'assistant', sessionId, cwd, uuid: 'a1', parentUuid: 'u1', timestamp: now,
      message: { id: 'msg_uat', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'UAT browse fixture answer' }] },
    }),
  ].join('\n') + '\n');

  const setup = await pan(homeA, ['vault', 'setup', `dir:${vaultDir}`, '--no-passphrase']);
  const phrase = setup.split('\n').map((line) => line.trim()).find((line) => line.split(/\s+/).length === 24);
  if (!phrase) throw new Error(`No recovery phrase in setup output:\n${setup}`);
  writeFileSync(join(fixtureDir, 'phrase.txt'), `${phrase}\n`);
  await pan(homeA, ['vault', 'save', transcript]);
  await pan(homeA, ['vault', 'sync']);
  await pan(homeB, ['vault', 'join', `dir:${vaultDir}`, '--phrase-file', join(fixtureDir, 'phrase.txt')]);

  const index = JSON.parse(readFileSync(join(homeA, 'vault', 'index.json'), 'utf8')) as { owned: Record<string, { vaultId: string }> };
  vaultId = index.owned[transcript]!.vaultId;

  process.env.OVERDECK_VAULT_IN_PEER = '1';
  dashboard = await startIsolatedDashboard({ home: homeB });
});

test.afterEach(async () => {
  await dashboard?.stop();
  dashboard = undefined;
  delete process.env.OVERDECK_VAULT_IN_PEER;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('a conversation saved on another machine is a read-only browse copy', async ({ browser }) => {
  const baseUrl = dashboard!.baseUrl;
  const name = `vault-${vaultId}`;

  // The first sync cycle runs 5 s after boot; the browse copy follows it.
  let row: { id: number; name: string; origin?: string } | undefined;
  await expect.poll(async () => {
    const response = await fetch(`${baseUrl}/api/conversations`);
    if (!response.ok) return null;
    const body = await response.json() as unknown;
    const rows = (Array.isArray(body) ? body : (body as { conversations?: unknown[] }).conversations ?? []) as Array<{ id: number; name: string; origin?: string }>;
    row = rows.find((entry) => entry.name === name);
    return row?.origin ?? null;
  }, { timeout: 30_000, intervals: [1_000] }).toBe('vault');

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`);

    // D-11: a foreign cwd and no registered project put the row in "No project".
    const noProject = page.getByText('No project', { exact: true }).first();
    if (await noProject.isVisible().catch(() => false)) await noProject.click();
    const badge = page.getByTestId('vault-owner-badge').first();
    let listPath = 'command-deck';
    if (!(await badge.isVisible({ timeout: 10_000 }).catch(() => false))) {
      listPath = 'conv-url';
      await page.goto(`${baseUrl}/conv/${row!.id}`);
    }
    await expect(page.getByTestId('vault-owner-badge').first()).toHaveText(`from ${OWNER_LABEL}`);
    await page.screenshot({ path: `${SHOT_DIR}/browse-row.png`, fullPage: true });
    test.info().annotations.push({ type: 'list-path', description: listPath });

    if (listPath === 'command-deck') await page.getByTestId('vault-owner-badge').first().click();
    await expect(page.getByText('UAT browse fixture question').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('UAT browse fixture answer').first()).toBeVisible();
    await expect(page.getByTestId('vault-read-only-notice')).toContainText(`pan vault resume ${vaultId}`);
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/browse-panel.png`, fullPage: true });
  } finally {
    await context.close();
  }
});
