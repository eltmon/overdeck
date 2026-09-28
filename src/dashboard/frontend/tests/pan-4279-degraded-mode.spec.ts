/**
 * Degraded mode end to end (PAN-4279 WI-8).
 *
 * Every journey runs against an **isolated** dashboard (its own temp
 * `OVERDECK_HOME` and port, no Deacon) in a fresh browser context, never the
 * operator's live dashboard on 3011. Stopping and restarting the server is the
 * point of these journeys, and that must never touch a real instance.
 *
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * What is exercised how, stated rather than implied:
 *
 *   - Server stopped / restarted: the real fixture process is stopped with
 *     `keepHome` and restarted on the same port and home, so the open page sees
 *     a genuine outage and a genuine recovery.
 *   - First load with the server down: a browser cannot load the app from a
 *     stopped server at all, so that journey serves the page and then refuses
 *     the server's API and `/ws/rpc` at the network boundary. Releasing the
 *     block stands in for the restart.
 *   - Held message: the fixture home cannot host a live conversation (that
 *     needs a harness), so the conversation list, transcript and message POST
 *     are intercepted. The outage itself and the reconnect are real.
 *   - Terminal inline reconnecting state: the fixture has no terminal to open;
 *     `XTerminal.tsx` is unchanged by PAN-4279 and covered by its unit tests.
 */

import { mkdirSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4279';
const BANNER = '[data-component="degraded-mode-banner"]';
const PIPELINE_VIEW = '[data-component="pipeline-view"]';
const FIRST_LOAD = '[data-component="first-load-screen"]';

let dashboard: IsolatedDashboard;

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test.beforeEach(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterEach(async () => {
  await dashboard?.stop();
});

async function restartServer(): Promise<void> {
  dashboard = await startIsolatedDashboard({ port: dashboard.port, home: dashboard.home });
}

async function collapseShell(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem('overdeck.ui.sidebarCollapsed', 'true');
    localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
  });
}

/** Open a page and wait until a live snapshot has been cached. */
async function openWarm(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${dashboard.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => localStorage.getItem('pan-snapshot-cache-v1') !== null, undefined, { timeout: 60_000 });
  return page;
}

async function isHiddenByAncestor(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
      if (getComputedStyle(node).display === 'none') return true;
    }
    return false;
  });
}

async function shootBanner(page: Page, phase: 'unreachable' | 'delayed'): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    // Same mechanism as useTheme: the `dark` class on <html>. Not persisted, so
    // nothing syncs a theme to the server.
    await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
    await page.screenshot({ path: `${SHOT_DIR}/${phase}-${theme}.png` });
  }
}

async function chord(page: Page, key: string): Promise<void> {
  await page.locator('body').click({ position: { x: 5, y: 700 } });
  await page.keyboard.press('g');
  await page.keyboard.press(key);
}

test('keeps cached pages visible and navigable while the server is stopped, then recovers', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await collapseShell(context);
    const page = await openWarm(context, '/pipeline');
    await expect(page.locator(PIPELINE_VIEW)).toBeVisible();

    await dashboard.stop({ keepHome: true });

    const unreachable = page.locator(`${BANNER}[data-phase="unreachable"]`);
    await expect(unreachable).toBeVisible({ timeout: 20_000 });
    await expect(unreachable).toContainText("Can't reach the Overdeck server — showing data from");
    await expect(unreachable.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(unreachable.getByRole('button', { name: 'Force Restart' })).toBeVisible();
    await expect(page.locator(PIPELINE_VIEW)).toBeVisible();
    expect(await isHiddenByAncestor(page, PIPELINE_VIEW)).toBe(false);
    await expect(page.locator(FIRST_LOAD)).toHaveCount(0);
    await expect(page.locator('#pan-recovery-overlay')).toHaveCount(0);

    // In-app navigation on cached data: Board, then back to Pipeline.
    await chord(page, 'b');
    await expect(page.locator('[data-testid^="kanban-column-"]').first()).toBeVisible();
    await expect(page.locator(PIPELINE_VIEW)).toHaveCount(0);
    await chord(page, 'p');
    await expect(page.locator(PIPELINE_VIEW)).toBeVisible();
    await expect(page.getByText('Server unreachable')).toHaveCount(0);

    await shootBanner(page, 'unreachable');

    await restartServer();
    await expect(page.locator(`${BANNER}:not([data-phase="live"])`)).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator(PIPELINE_VIEW)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('reports delayed live updates, never an unreachable server, while only the stream is down', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await collapseShell(context);
    // Warm the snapshot cache with a normal load first.
    const warm = await openWarm(context, '/pipeline');
    await warm.close();

    const page = await context.newPage();
    await page.routeWebSocket(/\/ws\/rpc/, (ws) => {
      ws.close();
    });
    await page.goto(`${dashboard.baseUrl}/pipeline`, { waitUntil: 'domcontentloaded' });

    const delayed = page.locator(`${BANNER}[data-phase="delayed"]`);
    await expect(delayed).toBeVisible({ timeout: 20_000 });
    await expect(delayed).toContainText('Live updates are delayed');
    await expect(page.locator(PIPELINE_VIEW)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Server unreachable');
    await expect(page.locator('body')).not.toContainText("Can't reach the Overdeck server");
    await expect(page.locator('#pan-recovery-overlay')).toHaveCount(0);

    await shootBanner(page, 'delayed');
  } finally {
    await context.close();
  }
});

test('shows the first-load screen only when nothing is cached, then loads the app', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await collapseShell(context);
    const page = await context.newPage();
    let blocked = true;
    await page.route('**/api/**', (route) => (blocked ? route.abort('connectionrefused') : route.fallback()));
    await page.routeWebSocket(/\/ws\/rpc/, (ws) => {
      if (blocked) ws.close();
      else ws.connectToServer();
    });

    await page.goto(`${dashboard.baseUrl}/pipeline`, { waitUntil: 'domcontentloaded' });

    const firstLoad = page.locator(FIRST_LOAD);
    await expect(firstLoad).toBeVisible({ timeout: 20_000 });
    await expect(firstLoad).toContainText("Can't reach the Overdeck server");
    await expect(firstLoad).toContainText('The dashboard will load as soon as the server answers.');
    await expect(page.locator(PIPELINE_VIEW)).toHaveCount(0);

    blocked = false;
    await firstLoad.getByRole('button', { name: 'Retry' }).click();

    await expect(page.locator(PIPELINE_VIEW)).toBeVisible({ timeout: 60_000 });
    await expect(firstLoad).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('holds a prompt submitted while the server is stopped and sends it once after restart', async ({ browser }) => {
  // A negative id keeps the transcript on the one-shot HTTP path, which is
  // intercepted below; a real id would subscribe over /ws/rpc, which the
  // isolated server cannot answer for a conversation it does not have.
  const conversation = {
    id: -4279,
    name: 'pan-4279-held',
    tmuxSession: 'pan-4279-held',
    status: 'active' as const,
    cwd: '/tmp/pan-4279-held',
    issueId: null,
    createdAt: '2026-09-27T23:00:00.000Z',
    endedAt: null,
    lastAttachedAt: '2026-09-27T23:00:00.000Z',
    sessionAlive: true,
    isFavorited: false,
    title: 'PAN-4279 held message',
    model: 'claude-sonnet-4-6',
    effort: 'medium',
  };
  const posts: Array<{ message?: string; clientMessageId?: string; retry?: boolean }> = [];

  const context = await browser.newContext();
  try {
    await collapseShell(context);
    await context.route('**/api/conversations', (route) => (
      route.request().method() === 'GET' ? route.fulfill({ json: [conversation] }) : route.fallback()
    ));
    await context.route('**/api/conversations/**', async (route) => {
      const request = route.request();
      const url = request.url();
      if (request.method() === 'POST' && url.endsWith('/message')) {
        posts.push(request.postDataJSON() as (typeof posts)[number]);
        return route.fulfill({ json: {} });
      }
      if (url.includes('/pending-input')) return route.fulfill({ json: [] });
      if (url.includes('/messages')) return route.fulfill({ json: { messages: [], workLog: [], streaming: false } });
      if (url.includes('/diffs')) return route.fulfill({ json: { summaries: [] } });
      return route.fulfill({ json: conversation });
    });

    const page = await openWarm(context, `/conv/${conversation.id}`);
    const editor = page.locator('[contenteditable="true"][aria-placeholder]').last();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('status', { name: 'Loading conversation' })).toHaveCount(0, { timeout: 30_000 });

    await dashboard.stop({ keepHome: true });
    await expect(page.locator(`${BANNER}[data-phase="unreachable"]`)).toBeVisible({ timeout: 20_000 });

    await editor.click();
    await page.keyboard.type('held ping');
    await page.getByTitle('Send message (Enter)').click();

    const heldLabel = page.getByText('Waiting to send — will send when the server reconnects');
    await expect(heldLabel).toBeVisible();
    expect(posts).toHaveLength(0);

    await restartServer();

    await expect.poll(() => posts.filter((post) => post.message === 'held ping').length, { timeout: 90_000 }).toBe(1);
    await expect(heldLabel).toHaveCount(0);
    const [sent] = posts.filter((post) => post.message === 'held ping');
    expect(sent?.clientMessageId).toBeTruthy();
    expect(sent?.retry).toBeUndefined();

    // Give any duplicate flush a chance to show up before asserting "exactly once".
    await page.waitForTimeout(3_000);
    expect(posts.filter((post) => post.clientMessageId === sent?.clientMessageId)).toHaveLength(1);
  } finally {
    await context.close();
  }
});
