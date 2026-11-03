/**
 * PAN-4476 — Shared Sessions prompt drafts and contributor submits, end to end: a host dashboard
 * shares a seeded conversation through the real share Worker (Miniflare on workerd), a second
 * dashboard joins it in a second browser context and is admitted as a contributor. The viewer's
 * draft reaches the host's share dialog as a suggestion over the real WebRTC `drafts` channel;
 * removing the contributor grant turns the viewer's composer back into a suggestion box.
 * `npm run build` first: the fixture serves the built frontend and server from `dist`. Not part of
 * `test:playwright` (slice-2/4 D-20 precedent). No prompt is submitted: the seeded conversation has
 * no live terminal behind it.
 *
 * Isolation: both dashboards are `startIsolatedDashboard` children with their own temp
 * `OVERDECK_HOME` and a fake `HOME`, never the operator's dashboard on 3011. Both `account.json`
 * files and `anywhere.directory_url` point at a dead loopback port, so no fixture token leaves the
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

const SHOT_DIR = 'test-results/pan-4476';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;
const BASE = 'https://share.test';
const DEAD_LOOPBACK = 'http://127.0.0.1:9';
const OWNER = { id: 1, login: 'owner' };
const VIEWER_A = { id: 100, login: 'alice' };
const NAME = 'pan-4476-demo';
const TITLE = 'PAN-4476 demo';
const SESSION = '4476aaaa-0000-4000-8000-000000004476';
const FIRST = 'First fixture message from the host';
const SECOND = 'Second fixture message from the host';
const SUGGESTION = 'Please also run the linter before you commit';
const THEMES = ['light', 'dark'] as const;
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
  const bundleDir = mkdtempSync(join(tmpdir(), 'pan-4476-mf-'));
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

  const hostHome = mkdtempSync(join(tmpdir(), 'pan-4476-host-'));
  const hostFakeHome = mkdtempSync(join(tmpdir(), 'pan-4476-host-fakehome-'));
  const viewerHome = mkdtempSync(join(tmpdir(), 'pan-4476-viewer-'));
  const viewerFakeHome = mkdtempSync(join(tmpdir(), 'pan-4476-viewer-fakehome-'));
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

/** The same mechanism as useTheme: the `dark` class on <html>; not persisted. */
async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
}

test('a contributor draft reaches the host as a suggestion, and removing the grant hides Send prompt', async ({ browser }) => {
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

    const admit = dialog.getByRole('button', { name: `Admit @${VIEWER_A.login} as contributor`, exact: true });
    await expect(admit).toBeEnabled({ timeout: 30_000 });
    await admit.click();
    await expect(viewerPage.getByText(FIRST)).toBeVisible({ timeout: 60_000 });
    await expect(viewerPage.getByText(SECOND)).toBeVisible();

    const box = viewerPage.getByRole('textbox', { name: 'Write a prompt' });
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.fill(SUGGESTION);
    await expect(viewerPage.getByRole('button', { name: 'Send prompt', exact: true })).toBeEnabled();

    const suggestion = dialog.getByRole('listitem', { name: `Suggestion from @${VIEWER_A.login}` });
    await expect(suggestion).toContainText(SUGGESTION, { timeout: 5_000 });

    for (const theme of THEMES) {
      await setTheme(viewerPage, theme);
      await viewerPage.screenshot({ path: `${SHOT_DIR}/viewer-composer-${theme}.png` });
      await setTheme(hostPage, theme);
      await dialog.screenshot({ path: `${SHOT_DIR}/host-suggestions-${theme}.png` });
    }

    const removeGrant = dialog.getByRole('button', { name: `Remove contributor from @${VIEWER_A.login}`, exact: true });
    await expect(removeGrant).toBeEnabled({ timeout: 30_000 });
    await removeGrant.click();
    await expect(viewerPage.getByRole('button', { name: 'Send prompt', exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(viewerPage.getByRole('textbox', { name: 'Suggest a prompt' })).toBeVisible();
    await expect(viewerPage.getByRole('textbox', { name: 'Suggest a prompt' })).toHaveValue(SUGGESTION);
  } finally {
    await hostContext.close();
    await viewerContext.close();
  }
});
