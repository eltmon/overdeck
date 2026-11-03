/**
 * PAN-4477 — the Shared Sessions read-only terminal, end to end: a host dashboard on the tmux
 * backend shares a seeded conversation whose tmux session runs `cat`, a second dashboard joins it
 * at `/#/shared/<code>`, switches to **Terminal**, and sees what the host session prints. What the
 * viewer types never reaches the host pane. `npm run build` first: the fixture serves the built
 * frontend and server from `dist`. Not part of `test:playwright` (same rule as PAN-4475's D-20).
 *
 * Isolation: both dashboards are `startIsolatedDashboard` children with their own temp
 * `OVERDECK_HOME` and a fake `HOME`, never the operator's dashboard on 3011. The host uses its own
 * tmux socket (`OVERDECK_TMUX_SOCKET_NAME=pan4477e2e`) and `terminal.backend: tmux`, so neither the
 * operator's tmux server nor Herdr is ever consulted; `afterAll` kills that socket's server.
 *
 * No fixture token may leave the machine: as in the PAN-4475 spec, both `account.json` files and
 * both `anywhere.directory_url` settings point at a dead loopback port.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createConversation } from '../../../lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import { claudeProjectDir, claudeProjectsRoot } from '../../../lib/runtimes/storage/claude-code.js';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const SERVICE_DIR = join(REPO_ROOT, 'services/share');

// miniflare and wrangler are devDependencies of the services/share workspace.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/share/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const SHOT_DIR = 'test-results/pan-4477';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;
const BASE = 'https://share.test';
const DEAD_LOOPBACK = 'http://127.0.0.1:9';
const OWNER = { id: 1, login: 'owner' };
const VIEWER_A = { id: 100, login: 'alice' };
const NAME = 'pan-4477-demo';
const TITLE = 'PAN-4477 demo';
const SESSION = '4477aaaa-0000-4000-8000-000000004477';
const TMUX_SOCKET = 'pan4477e2e';
const TMUX_SESSION = `conv-${NAME}`;
const FIRST = 'First fixture message from the host';
const LIVE_TEXT = 'live-4477';
const VIEWER_KEYS = 'viewer-keys-4477';
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const tokenFor = (githubId: number) => 'odd_' + githubId.toString(16).padStart(64, '0');

const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const USERS = ${JSON.stringify(
  Object.fromEntries([OWNER, VIEWER_A].map((u) => [tokenFor(u.id), { githubId: u.id, githubLogin: u.login }])),
)};
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    const user = USERS[token];
    if (!user) return { ok: false, error: 'invalid_token' };
    return { ok: true, userId: 'u' + user.githubId, githubId: user.githubId, githubLogin: user.githubLogin, deviceId: 'd' + user.githubId };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;

let mf: Miniflare | undefined;
let shareUrl = '';
let host: IsolatedDashboard | undefined;
let viewer: IsolatedDashboard | undefined;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

function tmux(...args: string[]) {
  return execFileAsync('tmux', ['-L', TMUX_SOCKET, ...args], { encoding: 'utf-8' });
}

/** A signed-in machine whose account and directory URLs point at a dead loopback port. */
function writeMachineFiles(home: string, user: { id: number; login: string }, extraConfig = ''): void {
  writeFileSync(join(home, 'account.json'), JSON.stringify({
    v: 1,
    baseUrl: DEAD_LOOPBACK,
    accessToken: tokenFor(user.id),
    deviceId: `d${user.id}`,
    label: user.login,
    githubLogin: user.login,
    githubId: user.id,
    signedInAt: '2026-11-03T00:00:00.000Z',
  }), { mode: 0o600 });
  writeFileSync(join(home, 'config.yaml'), `anywhere:\n  share_url: ${shareUrl}\n  directory_url: ${DEAD_LOOPBACK}\n${extraConfig}`);
}

/** Seed one managed conversation, bound to the fixture tmux session, with a one-line transcript. */
function seedConversation(home: string, fakeHome: string): void {
  const saved = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  try {
    createConversation({ name: NAME, tmuxSession: TMUX_SESSION, cwd: home, harness: 'claude-code', title: TITLE, workspaceId: null, claudeSessionId: SESSION });
  } finally {
    closeOverdeckDatabase();
    if (saved === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = saved;
  }
  const dir = claudeProjectDir(home, claudeProjectsRoot(fakeHome));
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: FIRST }, timestamp: '2026-11-03T00:00:00.000Z', uuid: 'u-1' });
  writeFileSync(join(dir, `${SESSION}.jsonl`), `${line}\n`);
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const bundleDir = mkdtempSync(join(tmpdir(), 'pan-4477-mf-'));
  const wrangler = join(SERVICE_DIR, 'node_modules/wrangler/bin/wrangler.js');
  await execFileAsync(wrangler, ['deploy', '--dry-run', '--outdir', bundleDir], {
    cwd: SERVICE_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const bundle = await readFile(join(bundleDir, 'index.js'), 'utf8');
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'overdeck-share',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
          env: {
            ROOMS: { type: 'durable-object', worker: 'overdeck-share', exportName: 'ShareRoom' },
            ACCOUNT: { type: 'worker', worker: 'account-stub', exportName: 'AccountRpc' },
            PUBLIC_BASE_URL: { type: 'text', value: BASE },
          },
          exports: { ShareRoom: { type: 'durable-object', storage: 'sqlite' } },
        },
      },
      {
        config: {
          name: 'account-stub',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'stub.js', modules: { 'stub.js': { type: 'esm', contents: ACCOUNT_STUB } } },
        },
      },
    ],
  });
  shareUrl = String(await mf.ready).replace(/\/$/, '');

  // The host conversation's terminal: `cat` echoes every line typed into the pane.
  await tmux('-f', '/dev/null', 'new-session', '-d', '-s', TMUX_SESSION, '-x', '100', '-y', '30', 'cat');

  const hostHome = mkdtempSync(join(tmpdir(), 'pan-4477-host-'));
  const hostFakeHome = mkdtempSync(join(tmpdir(), 'pan-4477-host-fakehome-'));
  const viewerHome = mkdtempSync(join(tmpdir(), 'pan-4477-viewer-'));
  const viewerFakeHome = mkdtempSync(join(tmpdir(), 'pan-4477-viewer-fakehome-'));
  writeMachineFiles(hostHome, OWNER, 'terminal:\n  backend: tmux\n');
  writeMachineFiles(viewerHome, VIEWER_A);
  seedConversation(hostHome, hostFakeHome);
  [host, viewer] = await Promise.all([
    startIsolatedDashboard({ home: hostHome, env: { HOME: hostFakeHome, OVERDECK_TMUX_SOCKET_NAME: TMUX_SOCKET } }),
    startIsolatedDashboard({ home: viewerHome, env: { HOME: viewerFakeHome } }),
  ]);
});

test.afterAll(async () => {
  await Promise.all([host?.stop(), viewer?.stop()]);
  host = undefined;
  viewer = undefined;
  await mf?.dispose();
  mf = undefined;
  await tmux('kill-server').catch(() => undefined);
});

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ ...DESKTOP });
  await context.route('**/avatars.githubusercontent.com/**', (route) => route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG }));
  return context;
}

async function conversationId(page: Page, baseUrl: string): Promise<number> {
  const listed = await page.request.get(`${baseUrl}/api/conversations`);
  const body = await listed.json() as Array<{ id: number; name: string }> | { conversations: Array<{ id: number; name: string }> };
  const rows = Array.isArray(body) ? body : body.conversations;
  const id = rows.find((row) => row.name === NAME)?.id;
  expect(id, 'the seeded conversation is listed').toBeDefined();
  return id as number;
}

test('an admitted viewer watches the host tmux terminal live and cannot type into it', async ({ browser }) => {
  const hostContext = await newContext(browser);
  const viewerContext = await newContext(browser);
  try {
    const hostPage = await hostContext.newPage();
    const id = await conversationId(hostPage, host!.baseUrl);
    await hostPage.goto(`${host!.baseUrl}/conv/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(hostPage.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 60_000 });
    await hostPage.getByLabel('More conversation actions').click();
    await hostPage.getByRole('menuitem', { name: 'Share this conversation' }).click();
    const dialog = hostPage.getByRole('dialog', { name: 'Share conversation' });
    await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
    const joinLink = dialog.getByLabel('Join link');
    await expect(joinLink).toHaveValue(/\/s\/[A-Z0-9]{8}$/, { timeout: 60_000 });
    const code = (await joinLink.inputValue()).split('/s/')[1] as string;

    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`${viewer!.baseUrl}/#/shared/${code}`, { waitUntil: 'domcontentloaded' });
    await expect(viewerPage.getByRole('heading', { name: 'Join a shared conversation' })).toBeVisible({ timeout: 60_000 });
    await viewerPage.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(viewerPage.getByRole('heading', { name: 'Waiting for the host to let you in' })).toBeVisible({ timeout: 60_000 });
    // Buttons use `exact: true`: `Admit @alice` would also match `Admit @alice as contributor`.
    const admit = dialog.getByRole('button', { name: 'Admit @alice', exact: true });
    await expect(admit).toBeEnabled({ timeout: 30_000 });
    await admit.click();

    const terminalToggle = viewerPage.getByRole('button', { name: 'Terminal', exact: true });
    await expect(terminalToggle).toBeVisible({ timeout: 60_000 });
    await terminalToggle.click();
    const terminal = viewerPage.getByTestId('shared-terminal');
    await expect(terminal).toBeVisible();

    await tmux('send-keys', '-t', TMUX_SESSION, LIVE_TEXT, 'Enter');
    await expect(terminal).toContainText(LIVE_TEXT, { timeout: 60_000 });
    await viewerPage.screenshot({ path: `${SHOT_DIR}/terminal-live.png` });

    // Read-only: the viewer's keystrokes must never reach the host pane.
    await terminal.click();
    await viewerPage.keyboard.type(VIEWER_KEYS);
    await viewerPage.keyboard.press('Enter');
    await viewerPage.waitForTimeout(1_000);
    const { stdout: pane } = await tmux('capture-pane', '-p', '-t', TMUX_SESSION);
    expect(pane).toContain(LIVE_TEXT);
    expect(pane).not.toContain(VIEWER_KEYS);
    await expect(terminal).not.toContainText(VIEWER_KEYS);
    await viewerPage.screenshot({ path: `${SHOT_DIR}/terminal-read-only.png` });
  } finally {
    await hostContext.close();
    await viewerContext.close();
  }
});
