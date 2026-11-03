/**
 * PAN-4478 — Shared Sessions controller handoff and reclaim, end to end: a host dashboard shares a
 * seeded conversation through the real share Worker (Miniflare on workerd), two more dashboards join
 * it in their own browser contexts. The host admits alice and hands her control; alice's page shows
 * the controller panel and admits bob over the real WebRTC `control` channel, and the host's server
 * relays that admit to the share service. The host then reclaims control and alice's panel goes away.
 * `npm run build` first: the fixture serves the built frontend and server from `dist`. Not part of
 * `test:playwright` (slice-2/4/5 precedent). No prompt is sent: the seeded conversation has no live
 * terminal behind it.
 *
 * Isolation: all three dashboards are `startIsolatedDashboard` children with their own temp
 * `OVERDECK_HOME` and a fake `HOME`, never the operator's dashboard on 3011. Every `account.json`
 * and `anywhere.directory_url` points at a dead loopback port, so no fixture token leaves the
 * machine. GitHub avatars are served a local 1×1 PNG.
 *
 * Buttons are located with `exact: true`: Playwright's name match is a case-insensitive substring
 * match, so `Admit @alice` would also match `Admit @alice as contributor`.
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

const SHOT_DIR = 'test-results/pan-4478';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;
const BASE = 'https://share.test';
const DEAD_LOOPBACK = 'http://127.0.0.1:9';
const OWNER = { id: 1, login: 'owner' };
const ALICE = { id: 100, login: 'alice' };
const BOB = { id: 200, login: 'bob' };
const NAME = 'pan-4478-demo';
const TITLE = 'PAN-4478 demo';
const SESSION = '4478aaaa-0000-4000-8000-000000004478';
const FIRST = 'First fixture message from the host';
const SECOND = 'Second fixture message from the host';
const THEMES = ['light', 'dark'] as const;
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const tokenFor = (githubId: number) => 'odd_' + githubId.toString(16).padStart(64, '0');

const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const USERS = ${JSON.stringify(
  Object.fromEntries([OWNER, ALICE, BOB].map((u) => [tokenFor(u.id), { githubId: u.id, githubLogin: u.login }])),
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
let alice: IsolatedDashboard | undefined;
let bob: IsolatedDashboard | undefined;

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
  writeFileSync(join(dir, `${SESSION}.jsonl`), `${userLine(FIRST, 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine(SECOND, 'u-2', '2026-11-03T00:00:01.000Z')}\n`);
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const bundleDir = mkdtempSync(join(tmpdir(), 'pan-4478-mf-'));
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

  const homes = [OWNER, ALICE, BOB].map((user) => {
    const home = mkdtempSync(join(tmpdir(), `pan-4478-${user.login}-`));
    const fakeHome = mkdtempSync(join(tmpdir(), `pan-4478-${user.login}-fakehome-`));
    writeMachineFiles(home, user);
    return { home, fakeHome };
  });
  seedConversation(homes[0]!.home, homes[0]!.fakeHome);
  [host, alice, bob] = await Promise.all(
    homes.map(({ home, fakeHome }) => startIsolatedDashboard({ home, env: { HOME: fakeHome } })),
  );
});

test.afterAll(async () => {
  await Promise.all([host?.stop(), alice?.stop(), bob?.stop()]);
  host = undefined;
  alice = undefined;
  bob = undefined;
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

/** The same mechanism as useTheme: the `dark` class on <html>; not persisted. */
async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
}

const LOBBY = 'Waiting for the host to let you in';
const CONTROLLER_PANEL = '[data-component="shared-controller"]';

/** Opens the join page and asks to join; resolves once the viewer waits in the lobby. */
async function joinLobby(page: Page, baseUrl: string, code: string): Promise<void> {
  await page.goto(`${baseUrl}/#/shared/${code}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Join a shared conversation' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('heading', { name: LOBBY })).toBeVisible({ timeout: 60_000 });
}

test('the host hands control to alice, alice admits bob, and the host reclaims control', async ({ browser }) => {
  const hostContext = await newContext(browser);
  const aliceContext = await newContext(browser);
  const bobContext = await newContext(browser);
  try {
    // 1. The owner shares the seeded conversation; alice joins and is admitted.
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

    const alicePage = await aliceContext.newPage();
    await joinLobby(alicePage, alice!.baseUrl, code);
    const admitAlice = dialog.getByRole('button', { name: `Admit @${ALICE.login}`, exact: true });
    await expect(admitAlice).toBeEnabled({ timeout: 30_000 });
    await admitAlice.click();
    await expect(alicePage.getByText(FIRST)).toBeVisible({ timeout: 60_000 });
    await expect(alicePage.getByText(SECOND)).toBeVisible();

    // 2. The owner hands control to alice.
    const handToAlice = dialog.getByRole('button', { name: `Hand control to @${ALICE.login}`, exact: true });
    await expect(handToAlice).toBeEnabled({ timeout: 30_000 });
    await handToAlice.click();
    const panel = alicePage.locator(CONTROLLER_PANEL);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('heading', { name: 'You have control' })).toBeVisible();
    await expect(dialog.getByText(`@${ALICE.login} has control.`)).toBeVisible({ timeout: 10_000 });
    const reclaim = dialog.getByRole('button', { name: 'Reclaim control', exact: true });
    await expect(reclaim).toBeVisible();

    // 3. Bob waits in the lobby; alice admits him from her controller panel.
    const bobPage = await bobContext.newPage();
    await joinLobby(bobPage, bob!.baseUrl, code);
    const admitBob = panel.getByRole('button', { name: `Admit @${BOB.login}`, exact: true });
    await expect(admitBob).toBeEnabled({ timeout: 30_000 });
    await admitBob.click();
    await expect(bobPage.getByRole('heading', { name: LOBBY })).toHaveCount(0, { timeout: 10_000 });
    await expect(bobPage.getByText(FIRST)).toBeVisible({ timeout: 60_000 });
    await expect(bobPage.getByText(`@${ALICE.login} has control`, { exact: true })).toBeVisible({ timeout: 10_000 });

    for (const theme of THEMES) {
      await setTheme(alicePage, theme);
      await alicePage.screenshot({ path: `${SHOT_DIR}/viewer-controller-${theme}.png` });
      await setTheme(hostPage, theme);
      await dialog.screenshot({ path: `${SHOT_DIR}/host-reclaim-${theme}.png` });
    }

    // 4. The owner reclaims control: alice's panel goes away and the owner's actions come back.
    await reclaim.click();
    await expect(panel).toHaveCount(0, { timeout: 10_000 });
    await expect(dialog.getByRole('button', { name: `Hand control to @${BOB.login}`, exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole('button', { name: 'Reclaim control', exact: true })).toHaveCount(0);
  } finally {
    await hostContext.close();
    await aliceContext.close();
    await bobContext.close();
  }
});
