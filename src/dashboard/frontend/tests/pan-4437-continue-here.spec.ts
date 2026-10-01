/**
 * PAN-4437 — Session Vault "Continue here", end to end across machines.
 *
 * Machine A (`machine-a`, a temp OVERDECK_HOME) saves three Claude
 * transcripts to a `dir:` vault:
 *   - T1 in checkout C while C is dirty, so the record carries a code snapshot;
 *   - T2 in C after it is clean again, for the adoption race;
 *   - T3 in a repo whose origin is https://github.com/acme/not-registered.git,
 *     deleted afterwards, for the clone offer.
 * Machine B (`machine-b`) joins and runs an isolated dashboard with a fake
 * `HOME` (so nothing reaches the operator's ~/.claude), a stub `claude` on
 * `PATH` that records its argv, and the vault service on (peer mode).
 * Machine C (`machine-c`) joins only to win the race from the CLI.
 *
 * The isolated home gets its own tmux socket (`overdeck-<sha1(home)>`), so the
 * spawn never touches the host's tmux server. afterAll kills that server, every
 * stub `claude` (by recorded PID) and every process whose command line names
 * this run's temp root (launchers, pty-supervisors), which outlive the dashboard.
 * `npm run build` first: the fixture serves `dist` and the CLI runs from it.
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CLI = join(REPO_ROOT, 'dist/cli/index.js');
const SHOT_DIR = 'test-results/pan-4437';
const CLONE_URL = 'https://github.com/acme/not-registered.git';

interface Row { id: number; name: string; origin?: string; cwd?: string; claudeSessionId?: string | null }

let dashboard: IsolatedDashboard | undefined;
let root = '';
const ids: Record<'t1' | 't2' | 't3', string> = { t1: '', t2: '', t3: '' };
let homeB = '';
let homeC = '';
let fakeHome = '';
let fakeHomeC = '';
let checkout = '';
let stubDir = '';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

async function run(command: string, args: string[], env: Record<string, string> = {}, cwd = REPO_ROOT): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { cwd, env: { ...process.env, ...env }, timeout: 90_000 });
  return stdout;
}

const pan = (home: string, args: string[], env: Record<string, string> = {}) =>
  run('node', [CLI, ...args], { OVERDECK_HOME: home, ...env });
const git = (cwd: string, ...args: string[]) => run('git', args, {}, cwd);

function identity(home: string, label: string): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'environment-id.json'), JSON.stringify({ v: 1, environmentId: randomUUID(), label, createdAt: new Date().toISOString() }));
}

function transcript(cwd: string, text: string): string {
  const sessionId = randomUUID();
  const path = join(root, 'transcripts', `${sessionId}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(path, [
    JSON.stringify({ type: 'user', sessionId, cwd, message: { role: 'user', content: `${text} question` }, uuid: 'u1', timestamp: now }),
    JSON.stringify({
      type: 'assistant', sessionId, cwd, uuid: 'a1', parentUuid: 'u1', timestamp: now,
      message: { id: `msg_${sessionId.slice(0, 8)}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `${text} answer` }] },
    }),
  ].join('\n') + '\n');
  return path;
}

/** Every `.jsonl` under `dir` (none when it does not exist). */
function jsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.jsonl'));
}

async function conversations(): Promise<Row[]> {
  const response = await fetch(`${dashboard!.baseUrl}/api/conversations`);
  if (!response.ok) return [];
  const body = await response.json() as unknown;
  return (Array.isArray(body) ? body : (body as { conversations?: unknown[] }).conversations ?? []) as Row[];
}

async function openBrowseCopy(page: Page, vaultId: string): Promise<void> {
  const row = (await conversations()).find((entry) => entry.name === `vault-${vaultId}`);
  if (!row) throw new Error(`browse row vault-${vaultId} is missing`);
  await page.goto(`${dashboard!.baseUrl}/conv/${row.id}`);
  await expect(page.getByTestId('vault-read-only-notice')).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pan-4437-'));
  const homeA = join(root, 'home-a');
  homeB = join(root, 'home-b');
  homeC = join(root, 'home-c');
  fakeHome = join(root, 'user-home-b');
  fakeHomeC = join(root, 'user-home-c');
  stubDir = join(root, 'stub');
  const vault = join(root, 'vault');
  for (const dir of [fakeHome, fakeHomeC, stubDir, vault]) mkdirSync(dir, { recursive: true });
  identity(homeA, 'machine-a');
  identity(homeB, 'machine-b');
  identity(homeC, 'machine-c');

  // `exec` keeps the PID, so afterAll can kill every stub the dashboard started.
  writeFileSync(join(stubDir, 'claude'), `#!/bin/sh\necho $$ >> "${join(stubDir, 'pids')}"\necho "$@" >> "${join(stubDir, 'argv.log')}"\nexec sleep 600\n`);
  chmodSync(join(stubDir, 'claude'), 0o755);

  // R (bare) and C, a clone of R with one pushed commit.
  const bare = join(root, 'origin.git');
  await run('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  checkout = join(root, 'checkout');
  await run('git', ['clone', '-q', bare, checkout]);
  await git(checkout, 'config', 'user.name', 'UAT');
  await git(checkout, 'config', 'user.email', 'uat@example.com');
  writeFileSync(join(checkout, 'app.txt'), 'original\n');
  await git(checkout, 'add', '-A');
  await git(checkout, 'commit', '-q', '-m', 'init');
  await git(checkout, 'push', '-q', '-u', 'origin', 'HEAD:main');

  const setup = await pan(homeA, ['vault', 'setup', `dir:${vault}`, '--no-passphrase']);
  const phrase = setup.split('\n').map((line) => line.trim()).find((line) => line.split(/\s+/).length === 24);
  if (!phrase) throw new Error(`No recovery phrase in setup output:\n${setup}`);
  const phraseFile = join(root, 'phrase.txt');
  writeFileSync(phraseFile, `${phrase}\n`);

  // T1: saved while C is dirty, so `save` captures a code snapshot; then C is restored clean.
  writeFileSync(join(checkout, 'app.txt'), 'changed on machine-a\n');
  writeFileSync(join(checkout, 'new.txt'), 'added on machine-a\n');
  const t1 = transcript(checkout, 'UAT continue');
  await pan(homeA, ['vault', 'save', t1]);
  await git(checkout, 'checkout', '--', '.');
  rmSync(join(checkout, 'new.txt'));

  // T2: saved from the clean checkout.
  const t2 = transcript(checkout, 'UAT race');
  await pan(homeA, ['vault', 'save', t2]);

  // T3: a repo whose origin is not registered anywhere, removed after saving.
  const gone = join(root, 'not-registered');
  await run('git', ['init', '-q', '-b', 'main', gone]);
  await git(gone, 'config', 'user.name', 'UAT');
  await git(gone, 'config', 'user.email', 'uat@example.com');
  writeFileSync(join(gone, 'readme.txt'), 'x\n');
  await git(gone, 'add', '-A');
  await git(gone, 'commit', '-q', '-m', 'init');
  await git(gone, 'remote', 'add', 'origin', CLONE_URL);
  const t3 = transcript(gone, 'UAT clone');
  await pan(homeA, ['vault', 'save', t3]);
  rmSync(gone, { recursive: true, force: true });
  await pan(homeA, ['vault', 'sync']);

  const index = JSON.parse(readFileSync(join(homeA, 'vault', 'index.json'), 'utf8')) as { owned: Record<string, { vaultId: string }> };
  ids.t1 = index.owned[t1]!.vaultId;
  ids.t2 = index.owned[t2]!.vaultId;
  ids.t3 = index.owned[t3]!.vaultId;

  await pan(homeB, ['vault', 'join', `dir:${vault}`, '--phrase-file', phraseFile]);
  await pan(homeC, ['vault', 'join', `dir:${vault}`, '--phrase-file', phraseFile], { HOME: fakeHomeC });
  await pan(homeC, ['vault', 'sync'], { HOME: fakeHomeC });

  dashboard = await startIsolatedDashboard({
    home: homeB,
    env: { HOME: fakeHome, PATH: `${stubDir}:${process.env.PATH ?? ''}`, OVERDECK_VAULT_IN_PEER: '1' },
  });
  // The first sync cycle runs 5 s after boot; the browse copies follow it.
  await expect.poll(async () => {
    const names = new Set((await conversations()).map((row) => row.name));
    return [ids.t1, ids.t2, ids.t3].every((id) => names.has(`vault-${id}`));
  }, { timeout: 45_000, intervals: [1_000] }).toBe(true);
});

test.afterAll(async () => {
  await dashboard?.stop({ keepHome: true });
  const socket = `overdeck-${createHash('sha1').update(resolve(homeB)).digest('hex').slice(0, 8)}`;
  await run('tmux', ['-L', socket, 'kill-server']).catch(() => undefined);
  const stubPids = existsSync(join(stubDir, 'pids')) ? readFileSync(join(stubDir, 'pids'), 'utf8').split('\n') : [];
  const rootPids = root ? (await run('pgrep', ['-f', root]).catch(() => '')).split('\n') : [];
  for (const pid of [...stubPids, ...rootPids].map(Number).filter((pid) => pid > 1 && pid !== process.pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  rmSync(root, { recursive: true, force: true });
});

test('a machine that continued first wins the race', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await openBrowseCopy(page, ids.t2);
    await page.getByRole('button', { name: 'Continue here' }).click();
    const dialog = page.getByTestId('vault-continue-dialog');
    await expect(dialog).toContainText('Continue in');

    // machine-c adopts T2 from the CLI while B's dialog is open.
    await pan(homeC, ['vault', 'resume', ids.t2.slice(0, 8), '--no-launch', '--no-code', '--on-drift', 'continue', '--cwd', checkout], { HOME: fakeHomeC });

    await dialog.getByRole('button', { name: 'Continue here' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Already continued on machine-c.');
    await page.screenshot({ path: `${SHOT_DIR}/already-continued.png`, fullPage: true });

    expect(jsonlFiles(join(fakeHome, '.claude', 'projects'))).toEqual([]);
    expect((await conversations()).some((row) => row.name === `vault-${ids.t2}`)).toBe(true);
  } finally {
    await context.close();
  }
});

test('the clone offer opens Add project with the URL filled in', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await openBrowseCopy(page, ids.t3);
    await page.getByRole('button', { name: 'Continue here' }).click();
    const dialog = page.getByTestId('vault-continue-dialog');
    await expect(dialog).toContainText('No registered project matches acme/not-registered.');
    await dialog.getByRole('button', { name: 'Clone and register acme/not-registered' }).click();
    // Not submitted: no network clone in UAT.
    await expect(page.getByLabel('Repository URL')).toHaveValue(CLONE_URL);
    await expect(dialog).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/clone-offer.png`, fullPage: true });
  } finally {
    await context.close();
  }
});

test('Continue here adopts, applies the code snapshot and resumes the conversation', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await openBrowseCopy(page, ids.t1);
    await page.getByRole('button', { name: 'Continue here' }).click();
    const dialog = page.getByTestId('vault-continue-dialog');
    await expect(dialog).toContainText('Apply the code snapshot from');
    await page.screenshot({ path: `${SHOT_DIR}/continue-dialog.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Continue here' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 60_000 });

    await expect.poll(async () => (await conversations()).some((row) => row.name === `vault-${ids.t1}`), { timeout: 15_000 }).toBe(false);
    // The dialog selects the new conversation through its /conv/<name> route.
    await expect(page).toHaveURL(/\/conv\/[^/]+$/);
    const name = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
    const rows = await conversations();
    const continued = rows.find((row) => row.name === name);
    expect(continued, `row ${name} among ${JSON.stringify(rows.map((row) => [row.name, row.origin, row.cwd, row.claudeSessionId]))}`).toBeTruthy();
    expect(continued!.cwd).toBe(checkout);
    expect(continued!.claudeSessionId).toBeTruthy();
    const sessionId = continued!.claudeSessionId!;
    const encoded = checkout.replace(/[^a-zA-Z0-9-]/g, '-');
    expect(existsSync(join(fakeHome, '.claude', 'projects', encoded, `${sessionId}.jsonl`))).toBe(true);
    expect(readFileSync(join(checkout, 'app.txt'), 'utf8')).toBe('changed on machine-a\n');
    expect(readFileSync(join(checkout, 'new.txt'), 'utf8')).toBe('added on machine-a\n');

    const argvLog = join(stubDir, 'argv.log');
    const launched = await expect.poll(() => (existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''), { timeout: 30_000 })
      .toContain(`--resume ${sessionId}`).then(() => true, () => false);
    if (!launched) {
      const log = existsSync(join(homeB, 'server.log')) ? readFileSync(join(homeB, 'server.log'), 'utf8').split('\n').slice(-20).join('\n') : '';
      test.info().annotations.push({ type: 'spawn not verified', description: log });
    }
    await expect(page.getByTestId('vault-read-only-notice')).toHaveCount(0, { timeout: 15_000 });
    await page.screenshot({ path: `${SHOT_DIR}/continued.png`, fullPage: true });
  } finally {
    await context.close();
  }
});
