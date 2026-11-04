/**
 * PAN-4473 — the share dialog and its lobby panel, opened from the conversation's ⋮ menu on an
 * isolated dashboard (its own temp `OVERDECK_HOME` and port, no Deacon), never the operator's live
 * one. `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * `GET /api/shares` is mocked with a share whose lobby has two joiners, two admitted viewers (one
 * contributor, one offline) and one blocked identity; GitHub avatars are a local 1×1 PNG. The spec
 * checks the three sections, that **Admit as contributor** sends exactly one
 * `{type:'admit', githubId, contributor:true}` command, and writes light and dark screenshots to
 * test-results/pan-4473/. Not part of `test:playwright` (D-16).
 *
 * Buttons are located with `exact: true`: Playwright's name match is a case-insensitive substring
 * match, so `Admit @alice` would also match `Admit @alice as contributor`.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { ListSharesResponse, ShareView } from '@overdeck/contracts';
import { createConversation } from '../../../lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4473';
const FIRST_LOAD = '[data-component="first-load-screen"]';
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const NAME = 'pan-4473-demo';
const TITLE = 'PAN-4473 demo';
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const avatar = (id: number) => `https://avatars.githubusercontent.com/u/${id}`;
const person = (githubId: number, login: string) => ({ githubId, login, avatarUrl: avatar(githubId) });

const SHARE: ShareView = {
  shortCode: 'BCDFGHJK',
  joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
  scope: { kind: 'conversation', conversationId: NAME },
  createdAt: '2026-11-02T00:00:00.000Z',
  connection: 'connected',
  lastError: null,
  snapshot: {
    shortCode: 'BCDFGHJK',
    scope: { kind: 'conversation', conversationId: NAME },
    dataOwner: person(1, 'owner'),
    controllerGithubId: 1,
    hostConnected: true,
    participants: [
      { ...person(100, 'alice'), state: 'lobby', contributor: false, connected: true },
      { ...person(500, 'erin'), state: 'lobby', contributor: false, connected: true },
      { ...person(200, 'bob'), state: 'admitted', contributor: true, connected: true },
      { ...person(300, 'carol'), state: 'admitted', contributor: false, connected: false },
    ],
    blocked: [person(400, 'dave')],
  },
};

let dashboard: IsolatedDashboard | undefined;
let conversationId: number | undefined;

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

/** Seed one managed conversation into the temp home before the server opens it. */
function seedConversation(home: string): void {
  const saved = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  try {
    createConversation({ name: NAME, tmuxSession: `conv-${NAME}`, cwd: home, harness: 'claude-code', title: TITLE, workspaceId: null });
  } finally {
    closeOverdeckDatabase();
    if (saved === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = saved;
  }
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), 'pan-4473-'));
  seedConversation(home);
  dashboard = await startIsolatedDashboard({ home });
});

test.afterAll(async () => {
  await dashboard?.stop();
  dashboard = undefined;
});

/** A fresh context in the given theme with mocked shares and avatars; records each command body. */
async function openShareDialog(browser: Browser, theme: Theme, commands: unknown[]): Promise<Page> {
  const context = await browser.newContext({ ...DESKTOP });
  await context.addInitScript((value) => {
    try { window.localStorage.setItem('overdeck.ui.theme', value); } catch { /* storage blocked */ }
  }, theme);
  const page = await context.newPage();
  const list: ListSharesResponse = { shares: [SHARE] };
  await page.route('**/api/shares', (route) => route.fulfill({ json: list }));
  await page.route('**/api/shares/*/commands', (route) => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.route('**/avatars.githubusercontent.com/**', (route) => route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG }));

  if (conversationId === undefined) {
    const listed = await page.request.get(`${dashboard!.baseUrl}/api/conversations`);
    const conversations = await listed.json() as Array<{ id: number; name: string }> | { conversations: Array<{ id: number; name: string }> };
    const rows = Array.isArray(conversations) ? conversations : conversations.conversations;
    conversationId = rows.find((row) => row.name === NAME)?.id;
    expect(conversationId, 'the seeded conversation is listed').toBeDefined();
  }

  await page.goto(`${dashboard!.baseUrl}/conv/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(FIRST_LOAD)).toHaveCount(0, { timeout: 60_000 });
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await page.getByLabel('More conversation actions').click();
  await page.getByRole('menuitem', { name: 'Share this conversation' }).click();
  await expect(page.getByRole('dialog', { name: 'Share conversation' })).toBeVisible();
  return page;
}

for (const theme of THEMES) {
  test(`the lobby panel lists joiners, viewers and blocked people and admits as contributor (${theme})`, async ({ browser }) => {
    const commands: unknown[] = [];
    const page = await openShareDialog(browser, theme, commands);
    const dialog = page.getByRole('dialog', { name: 'Share conversation' });

    await expect(dialog.getByLabel('Join link')).toHaveValue(SHARE.joinUrl);
    await expect(dialog.getByRole('heading', { name: 'Waiting to join (2)' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'In the room (2)' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Blocked (1)' })).toBeVisible();
    for (const login of ['alice', 'erin', 'bob', 'carol', 'dave']) await expect(dialog.getByText(`@${login}`, { exact: true })).toBeVisible();
    await expect(dialog.getByText('contributor', { exact: true })).toBeVisible();
    await expect(dialog.getByText('offline', { exact: true })).toBeVisible();
    const avatars = dialog.locator('[data-component="sharing-lobby"] img');
    await expect(avatars).toHaveCount(5);
    await expect.poll(() => avatars.evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);

    await dialog.screenshot({ path: `${SHOT_DIR}/share-lobby-${theme}.png` });

    const admit = dialog.getByRole('button', { name: 'Admit @alice as contributor', exact: true });
    await expect(admit).toBeEnabled();
    const posted = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/api/shares/BCDFGHJK/commands'));
    await admit.click();
    await posted;
    await expect.poll(() => commands.length).toBe(1);
    expect(commands).toEqual([{ type: 'admit', githubId: 100, contributor: true }]);

    await page.context().close();
  });
}
