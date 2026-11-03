/**
 * PAN-4475 — the Shared Sessions viewer, end to end: a host dashboard shares a seeded conversation
 * through the real share Worker (Miniflare on workerd), a second dashboard joins it at
 * `/#/shared/<code>` in a second browser context, and the host conversation arrives over a real
 * Chromium `RTCPeerConnection`. `npm run build` first: the fixture serves the built frontend and
 * server from `dist`. Not part of `test:playwright` (D-20); the Miniflare integration test is the
 * CI-run relay coverage.
 *
 * Isolation: both dashboards are `startIsolatedDashboard` children with their own temp
 * `OVERDECK_HOME` and a fake `HOME`, never the operator's dashboard on 3011.
 *
 * No fixture token may leave the machine: Anywhere boot (`services/anywhere-boot.ts`) opens the
 * overdeck.ai directory socket whenever `account.json` exists, so both `account.json` files use
 * `baseUrl: http://127.0.0.1:9` and both `config.yaml` files set `anywhere.directory_url` to the
 * same dead loopback port. GitHub avatars are served a local 1×1 PNG.
 *
 * Test 2 drives the landing page against a stubbed probe: every request to `localhost:3011` and
 * `127.0.0.1:3011` is intercepted with `context.route` before any navigation, so the spec never
 * reaches the real port 3011.
 *
 * Buttons are located with `exact: true`: Playwright's name match is a case-insensitive substring
 * match, so `Admit @alice` would also match `Admit @alice as contributor`.
 */

import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
import { createRoom } from '../../../lib/sharing/share-service.js';
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

const SHOT_DIR = 'test-results/pan-4475';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;
const BASE = 'https://share.test';
const DEAD_LOOPBACK = 'http://127.0.0.1:9';
const OWNER = { id: 1, login: 'owner' };
const VIEWER_A = { id: 100, login: 'alice' };
const NAME = 'pan-4475-demo';
const TITLE = 'PAN-4475 demo';
const SESSION = '4475aaaa-0000-4000-8000-000000004475';
const FIRST = 'First fixture message from the host';
const SECOND = 'Second fixture message from the host';
const THIRD = 'Third message appended while the viewer watches';
const STUB_TEXT = 'PAN-4475 STUB DASHBOARD';
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
let transcript = '';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

function userLine(text: string, uuid: string, timestamp: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp, uuid });
}

/** A signed-in machine whose account and directory URLs point at a dead loopback port. */
function writeMachineFiles(home: string, user: { id: number; login: string }): void {
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
  writeFileSync(join(home, 'config.yaml'), `anywhere:\n  share_url: ${shareUrl}\n  directory_url: ${DEAD_LOOPBACK}\n`);
}

/** Seed one managed conversation and its two-line transcript into the host home. */
function seedConversation(home: string, fakeHome: string): void {
  const saved = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  try {
    createConversation({ name: NAME, tmuxSession: `conv-${NAME}`, cwd: home, harness: 'claude-code', title: TITLE, workspaceId: null, claudeSessionId: SESSION });
  } finally {
    closeOverdeckDatabase();
    if (saved === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = saved;
  }
  const dir = claudeProjectDir(home, claudeProjectsRoot(fakeHome));
  mkdirSync(dir, { recursive: true });
  transcript = join(dir, `${SESSION}.jsonl`);
  writeFileSync(transcript, `${userLine(FIRST, 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine(SECOND, 'u-2', '2026-11-03T00:00:01.000Z')}\n`);
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const bundleDir = mkdtempSync(join(tmpdir(), 'pan-4475-mf-'));
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

  const hostHome = mkdtempSync(join(tmpdir(), 'pan-4475-host-'));
  const hostFakeHome = mkdtempSync(join(tmpdir(), 'pan-4475-host-fakehome-'));
  const viewerHome = mkdtempSync(join(tmpdir(), 'pan-4475-viewer-'));
  const viewerFakeHome = mkdtempSync(join(tmpdir(), 'pan-4475-viewer-fakehome-'));
  writeMachineFiles(hostHome, OWNER);
  writeMachineFiles(viewerHome, VIEWER_A);
  seedConversation(hostHome, hostFakeHome);
  [host, viewer] = await Promise.all([
    startIsolatedDashboard({ home: hostHome, env: { HOME: hostFakeHome } }),
    startIsolatedDashboard({ home: viewerHome, env: { HOME: viewerFakeHome } }),
  ]);
});

test.afterAll(async () => {
  await Promise.all([host?.stop(), viewer?.stop()]);
  host = undefined;
  viewer = undefined;
  await mf?.dispose();
  mf = undefined;
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

test('a viewer joins, waits in the lobby, sees the conversation live after admit, and is removed on kick', async ({ browser }) => {
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
    await expect(viewerPage.getByText(FIRST)).toHaveCount(0);
    await expect(viewerPage.getByText(SECOND)).toHaveCount(0);
    await expect(viewerPage.locator('[data-testid="shared-conversation-timeline"]')).toHaveCount(0);
    await viewerPage.screenshot({ path: `${SHOT_DIR}/lobby.png` });

    const admit = dialog.getByRole('button', { name: 'Admit @alice', exact: true });
    await expect(admit).toBeEnabled({ timeout: 30_000 });
    await admit.click();
    await expect(viewerPage.getByText(FIRST)).toBeVisible({ timeout: 60_000 });
    await expect(viewerPage.getByText(SECOND)).toBeVisible();
    await viewerPage.screenshot({ path: `${SHOT_DIR}/admitted.png` });

    appendFileSync(transcript, `${userLine(THIRD, 'u-3', '2026-11-03T00:00:02.000Z')}\n`);
    await expect(viewerPage.getByText(THIRD)).toBeVisible({ timeout: 30_000 });

    const kick = dialog.getByRole('button', { name: 'Kick @alice', exact: true });
    await expect(kick).toBeEnabled({ timeout: 30_000 });
    await kick.click();
    await expect(viewerPage.getByRole('heading', { name: 'Removed by host' })).toBeVisible({ timeout: 30_000 });
    await viewerPage.screenshot({ path: `${SHOT_DIR}/kicked.png` });
  } finally {
    await hostContext.close();
    await viewerContext.close();
  }
});

/** A room on the Miniflare service, created directly with the owner's token. */
async function activeRoomCode(): Promise<string> {
  const created = await createRoom(shareUrl, tokenFor(OWNER.id), { kind: 'conversation', conversationId: 'pan-4475-landing' });
  if (!created.ok) throw new Error(`createRoom failed: ${created.error}`);
  return created.room.shortCode;
}

test('the landing page finds a local Overdeck through the probe, and says so when it cannot', async ({ browser }) => {
  const code = await activeRoomCode();
  const shareOrigin = new URL(shareUrl).origin;

  const found = await browser.newContext({ ...DESKTOP });
  try {
    for (const origin of ['http://localhost:3011', 'http://127.0.0.1:3011']) {
      await found.route(`${origin}/**`, (route) => {
        if (new URL(route.request().url()).pathname === '/api/share-probe') {
          return route.fulfill({ json: { overdeck: true, v: 1 }, headers: { 'Access-Control-Allow-Origin': shareOrigin } });
        }
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>stub</title><body>${STUB_TEXT}</body>` });
      });
    }
    const page = await found.newPage();
    await page.goto(`${shareUrl}/s/${code}`);
    await page.waitForURL(`http://localhost:3011/#/shared/${code}`, { timeout: 30_000 });
    await expect(page.getByText(STUB_TEXT)).toBeVisible();
  } finally {
    await found.close();
  }

  const missing = await browser.newContext({ ...DESKTOP });
  try {
    for (const origin of ['http://localhost:3011', 'http://127.0.0.1:3011']) {
      await missing.route(`${origin}/**`, (route) => route.abort());
    }
    const page = await missing.newPage();
    await page.goto(`${shareUrl}/s/${code}`);
    await expect(page.getByText('Overdeck is not running on this computer', { exact: false })).toBeVisible({ timeout: 30_000 });
    const link = page.getByRole('link', { name: 'Open it in Overdeck on this computer' });
    await expect(link).toHaveAttribute('href', `http://localhost:3011/#/shared/${code}`);
    await page.screenshot({ path: `${SHOT_DIR}/landing-not-found.png` });
  } finally {
    await missing.close();
  }
});
