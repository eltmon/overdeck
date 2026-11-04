/**
 * PAN-2355 — the phone shell at /m, proved at 390×844 on an isolated dashboard
 * (its own temp `OVERDECK_HOME` and port, no Deacon), never the operator's live
 * one. `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Covers the PWA files (manifest, icons, service worker), a question answered
 * in two in-app taps (NFR-3), the `?subject=` deep link, the 44×44 tap-target
 * floor (NFR-4) and the worker's cross-origin fallback (D-2). Screenshots of
 * Needs you, Conversations and the pair screen land in test-results/pan-2355/.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createConversation } from '../../../lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-2355';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

let dashboard: IsolatedDashboard | undefined;

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test.afterEach(async () => {
  await dashboard?.stop();
  dashboard = undefined;
});

function auqRow(name: string, title: string, question: string, askedAt: string) {
  return {
    name,
    title,
    issueId: null,
    harness: 'claude-code',
    pendingInputKinds: ['askUserQuestion'],
    pendingAskUserQuestion: {
      toolUseId: `tu-${name}`,
      askedAt,
      questions: [{ question, options: [{ label: 'Yes' }, { label: 'No' }] }],
    },
  };
}

// PAN-4757: pin askedAt relative to now, not a hard-coded date. The Needs-you
// header renders formatRelativeTime(since) as "yesterday" once the question is
// 24-47h old, and getByRole name matching is a case-insensitive substring match,
// so a stale fixture date can make { name: 'Yes' } also match the header text.
const SHIP_ASKED_AT = Date.now() - 25 * 60 * 60 * 1000;
const PENDING = [
  auqRow('pan-2355-ship', 'Ship the phone shell', 'Ship it now?', new Date(SHIP_ASKED_AT).toISOString()),
  auqRow('pan-2355-docs', 'Write the phone docs', 'Publish the docs?', new Date(SHIP_ASKED_AT + 5 * 60 * 1000).toISOString()),
];

const CONVERSATIONS = [
  { id: 11, name: 'pan-2355-ship', title: 'Ship the phone shell', status: 'active', issueId: 'PAN-2355', createdAt: '2026-10-31T09:00:00.000Z', lastAttachedAt: null, lastActivityAt: '2026-11-01T06:50:00.000Z', sessionAlive: true, tmuxSession: 'conv-pan-2355-ship', cwd: '/tmp', endedAt: null },
  { id: 12, name: 'pan-2355-docs', title: 'Write the phone docs', status: 'active', issueId: null, createdAt: '2026-10-31T08:00:00.000Z', lastAttachedAt: null, lastActivityAt: '2026-11-01T05:10:00.000Z', sessionAlive: true, tmuxSession: 'conv-pan-2355-docs', cwd: '/tmp', endedAt: null },
];

/** Seed one managed conversation into the temp home before the server opens it. */
function seedConversation(home: string): void {
  const saved = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  try {
    createConversation({ name: 'pan-2355-real', tmuxSession: 'conv-pan-2355-real', cwd: home, harness: 'claude-code', title: 'Phone conversation view', workspaceId: null });
  } finally {
    closeOverdeckDatabase();
    if (saved === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = saved;
  }
}

async function phoneContext(browser: Browser, baseUrl: string): Promise<BrowserContext> {
  const context = await browser.newContext({ ...PHONE });
  await context.grantPermissions(['notifications'], { origin: baseUrl });
  return context;
}

/** Visible buttons and links inside the shell, each at least 44×44 CSS px. */
async function expectTapTargets(page: Page): Promise<void> {
  const targets = page.locator('[data-component="mobile-app"]').locator('button, a');
  const count = await targets.count();
  expect(count, 'the shell renders tappable controls').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    const label = (await target.textContent())?.trim() || (await target.getAttribute('aria-label')) || `#${i}`;
    expect(box, `${label} has a box`).not.toBeNull();
    expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
  }
}

test('the phone shell installs, answers a question in two taps and pairs', async ({ browser }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), 'pan-2355-'));
  seedConversation(home);
  dashboard = await startIsolatedDashboard({ home });
  const baseUrl = dashboard.baseUrl;

  // 1. PWA files.
  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  expect(manifestResponse.status).toBe(200);
  expect(manifestResponse.headers.get('content-type')).toContain('application/manifest+json');
  const manifest = await manifestResponse.json() as { start_url: string; scope: string; display: string; icons: Array<{ src: string }> };
  expect(manifest).toMatchObject({ start_url: '/m', scope: '/', display: 'standalone' });
  expect(manifest.icons).toHaveLength(4);
  for (const icon of manifest.icons) {
    const iconResponse = await fetch(`${baseUrl}${icon.src}`);
    expect(iconResponse.status, icon.src).toBe(200);
    expect(iconResponse.headers.get('content-type'), icon.src).toContain('image/png');
  }
  const workerResponse = await fetch(`${baseUrl}/sw.js`);
  expect(workerResponse.status).toBe(200);
  expect(workerResponse.headers.get('content-type')).toContain('javascript');

  const context = await phoneContext(browser, baseUrl);
  try {
    const page = await context.newPage();
    const posts: Array<{ url: string; body: { message?: string } }> = [];
    await page.route('**/api/conversations/pending-input', (route) => route.fulfill({ json: PENDING }));
    await page.route('**/api/conversations', (route) => route.fulfill({ json: CONVERSATIONS }));
    await page.route('**/api/conversations/*/message', async (route) => {
      posts.push({ url: route.request().url(), body: route.request().postDataJSON() as { message?: string } });
      await route.fulfill({ json: { ok: true } });
    });

    // 2. Two in-app taps answer the first question.
    await page.goto(`${baseUrl}/m`, { waitUntil: 'domcontentloaded' });
    const first = page.locator('[data-subject-id="pan-2355-ship"]');
    await expect(first).toHaveAttribute('data-expanded', 'true', { timeout: 30_000 });
    await expectTapTargets(page);
    await page.screenshot({ path: `${SHOT_DIR}/needs-you.png` });
    await first.getByRole('button', { name: 'Yes', exact: true }).tap();
    await first.getByRole('button', { name: 'Send' }).tap();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.url).toBe(`${baseUrl}/api/conversations/pan-2355-ship/message`);
    expect(posts[0]!.body.message).toMatch(/^Operator answered the pending question/);
    await expect(first).toHaveCount(0);

    // 3. The worker registered from the shell maps a cross-origin url to /m.
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 30_000 });
    expect(new URL(worker.url()).pathname).toBe('/sw.js');
    const notification = await worker.evaluate(() => (self as unknown as {
      overdeckNotificationFromPush: (text: string) => { options: { data: { url: string } } };
    }).overdeckNotificationFromPush(JSON.stringify({ title: 'T', body: 'B', url: 'https://evil.example/x' })));
    expect(notification.options.data.url).toBe('/m');

    // 4. A ?subject= deep link opens that card, not the first one.
    await page.goto(`${baseUrl}/m?subject=pan-2355-docs`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-subject-id="pan-2355-docs"]')).toHaveAttribute('data-expanded', 'true', { timeout: 30_000 });
    await expect(page.locator('[data-subject-id="pan-2355-ship"]')).toHaveAttribute('data-expanded', 'false');

    // 5. Conversations tab.
    await page.getByRole('button', { name: 'Conversations' }).tap();
    await expect(page.getByRole('list', { name: 'Conversations' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Conversations' }).locator('li').first()).toContainText('Ship the phone shell');
    await expectTapTargets(page);
    // The shell never widens or pans the page (the ?subject= scroll stays in the list).
    expect(await page.evaluate(() => [window.innerWidth, window.scrollX, window.scrollY])).toEqual([390, 0, 0]);
    await page.screenshot({ path: `${SHOT_DIR}/conversations.png` });
  } finally {
    await context.close();
  }

  // 6. A real conversation opens full screen in ConversationPanel without widening the page.
  const viewer = await phoneContext(browser, baseUrl);
  try {
    const page = await viewer.newPage();
    const listed = await page.request.get(`${baseUrl}/api/conversations`);
    const rows = await listed.json() as Array<{ id: number; name: string }>;
    const id = rows.find((row) => row.name === 'pan-2355-real')?.id;
    expect(id, 'the seeded conversation is listed').toBeDefined();
    await page.goto(`${baseUrl}/m?conversation=${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Phone conversation view' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => [window.innerWidth, window.scrollX, window.scrollY])).toEqual([390, 0, 0]);
    // Every header control stays on screen (the wrapper lets the desktop header wrap).
    const offscreen = await page.evaluate(() => Array.from(document.querySelectorAll('[data-component="mobile-app"] button'))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName));
    expect(offscreen).toEqual([]);
    await page.screenshot({ path: `${SHOT_DIR}/conversation.png` });
  } finally {
    await viewer.close();
  }

  // 7. With the session mint refused, the shell asks to pair.
  const unpaired = await phoneContext(browser, baseUrl);
  try {
    const page = await unpaired.newPage();
    await page.route('**/api/dashboard/session', (route) => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
    await page.goto(`${baseUrl}/m`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Pair this phone' })).toBeVisible({ timeout: 30_000 });
    await expectTapTargets(page);
    await page.screenshot({ path: `${SHOT_DIR}/pair.png` });
  } finally {
    await unpaired.close();
  }
});
