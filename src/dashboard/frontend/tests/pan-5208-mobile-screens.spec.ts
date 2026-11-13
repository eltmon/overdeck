/**
 * PAN-5208 — screenshots of the phone shell's three landing tabs (Needs you,
 * Conversations, Pipeline) at iPhone 14 and Pixel 7 sizes, light and dark, on
 * an isolated dashboard (its own temp `OVERDECK_HOME` and port, no Deacon),
 * never the operator's live one. `npm run build` first: the fixture serves the
 * built frontend from `dist`.
 *
 * One test per device; each opens a light and a dark context and makes one
 * page load per context, then moves between tabs by tapping the tab bar.
 * Screenshots land in test-results/pan-5208/<device>-<theme>-<tab>.png and are
 * copied into apps/mobile/acceptance/ for PAN-5208.md.
 *
 * Seeding follows pan-4661-mobile-pipeline.spec.ts: an `addInitScript`-seeded
 * `pan-snapshot-cache-v1` entry fills the pipeline store before any WebSocket
 * bootstrap, and `/ws/rpc` is closed so a real, empty bootstrap never
 * overwrites it. REST lists come from `page.route` fixtures.
 */

import { mkdirSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { DashboardSnapshot } from '@overdeck/contracts';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-5208';

const DEVICES = {
  iphone14: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  pixel7: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true },
} as const;

type DeviceName = keyof typeof DEVICES;
type Scheme = 'light' | 'dark';

const SCHEMES: readonly Scheme[] = ['light', 'dark'];

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const NOW = Date.now();

function iso(offsetMs = 0): string {
  return new Date(NOW + offsetMs).toISOString();
}

function buildSnapshot(): DashboardSnapshot {
  const issues = [
    { id: 'PAN-90001', identifier: 'PAN-90001', title: 'Ship the phone pipeline tab', labels: [], priority: 2, state: 'open', status: 'open', url: 'https://example.com/PAN-90001', createdAt: iso(-3_600_000), updatedAt: iso(-600_000) },
    { id: 'PAN-90002', identifier: 'PAN-90002', title: 'Review the conversation groups', labels: [], priority: 1, state: 'open', status: 'open', url: 'https://example.com/PAN-90002', createdAt: iso(-7_200_000), updatedAt: iso(-1_800_000) },
    { id: 'PAN-90003', identifier: 'PAN-90003', title: 'A long work-item title that wraps across two lines on a phone screen instead of overflowing', labels: [], priority: 2, state: 'open', status: 'open', url: 'https://example.com/PAN-90003', createdAt: iso(-10_800_000), updatedAt: iso(-300_000) },
    { id: 'PAN-90004', identifier: 'PAN-90004', title: 'Plan the next phone release', labels: [], priority: 3, state: 'open', status: 'open', url: 'https://example.com/PAN-90004', createdAt: iso(-86_400_000), updatedAt: iso(-43_200_000) },
  ];
  const derivedIssueStates = [
    { issueId: 'PAN-90001', state: 'ready' },
    { issueId: 'PAN-90002', state: 'in-review', attention: 'needs-you' },
    { issueId: 'PAN-90003', state: 'working' },
    { issueId: 'PAN-90004', state: 'planned' },
  ];
  return {
    sequence: 1,
    timestamp: iso(),
    specialists: [],
    backendPanes: [],
    agents: [],
    issues,
    derivedIssueStates,
  } as unknown as DashboardSnapshot;
}

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
      questions: [{ question, options: [{ label: 'Ship it' }, { label: 'Hold' }] }],
    },
  };
}

const PENDING = [
  auqRow('pan-5208-ship', 'Ship the phone shell', 'Ship the phone shell now?', iso(-20 * 60_000)),
  auqRow('pan-5208-docs', 'Write the phone docs', 'Publish the phone docs?', iso(-3 * 3_600_000)),
];

function conversationRow(id: number, title: string, lastActivityAt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `pan-5208-conv-${id}`,
    title,
    status: 'active',
    issueId: null,
    createdAt: iso(-86_400_000),
    lastAttachedAt: null,
    lastActivityAt,
    sessionAlive: true,
    tmuxSession: `conv-pan-5208-${id}`,
    cwd: '/tmp',
    endedAt: null,
    ...extra,
  };
}

const CONVERSATIONS = [
  conversationRow(1, 'Phone visual pass', iso(-5 * 60_000), { cwd: '/tmp/alpha/sub1', issueId: 'PAN-5208' }),
  conversationRow(2, 'Logo sting timings', iso(-40 * 60_000), { cwd: '/tmp/alpha/sub2' }),
  conversationRow(3, 'Beta release notes', iso(-2 * 3_600_000), { projectKey: 'beta', cwd: '/tmp/elsewhere-beta' }),
  conversationRow(4, 'Scratch questions', iso(-26 * 3_600_000), { cwd: '/tmp/elsewhere' }),
];

const PROJECTS = [
  { key: 'alpha', name: 'alpha', path: '/tmp/alpha' },
  { key: 'beta', name: 'beta', path: '/tmp/beta' },
];

async function installFixtures(page: Page, scheme: Scheme): Promise<void> {
  const cacheEntry = { data: buildSnapshot(), timestamp: iso() };
  await page.addInitScript(
    ({ entry, theme }) => {
      localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify(entry));
      localStorage.setItem('overdeck.ui.theme', theme);
      // Open the first project group so the Conversations shot shows rows.
      localStorage.setItem('pan-mobile-expanded-projects', JSON.stringify(['alpha']));
      sessionStorage.setItem('overdeck.logoSting.played', '1');
    },
    { entry: cacheEntry, theme: scheme },
  );

  await page.route('**/api/conversations/pending-input', (route) => route.fulfill({ json: PENDING }));
  await page.route('**/api/conversations', (route) => route.fulfill({ json: CONVERSATIONS }));
  await page.route('**/api/registered-projects', (route) => route.fulfill({ json: PROJECTS }));
  // A fresh context has no WS credential on the isolated server, so the real
  // handshake fails anyway; close it so the app keeps the seeded snapshot.
  await page.routeWebSocket(/\/ws\/rpc/, (ws) => ws.close());
}

async function captureDevice(browser: Browser, baseUrl: string, device: DeviceName): Promise<void> {
  for (const scheme of SCHEMES) {
    const context = await browser.newContext({ ...DEVICES[device], colorScheme: scheme, reducedMotion: 'reduce' });
    let pageLoads = 0;
    try {
      await context.grantPermissions(['notifications'], { origin: baseUrl });
      const page = await context.newPage();
      await installFixtures(page, scheme);

      pageLoads++;
      await page.goto(`${baseUrl}/m`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-component="mobile-app"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Ship the phone shell').first()).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `${SHOT_DIR}/${device}-${scheme}-needs-you.png` });

      await page.getByRole('button', { name: 'Conversations', exact: true }).tap();
      await expect(page.getByText('Phone visual pass')).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `${SHOT_DIR}/${device}-${scheme}-conversations.png` });

      await page.getByRole('button', { name: 'Pipeline', exact: true }).tap();
      await expect(page.locator('[data-issue-id="PAN-90001"]')).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `${SHOT_DIR}/${device}-${scheme}-pipeline.png` });

      expect(pageLoads, 'page loads in this context').toBeLessThanOrEqual(3);
    } finally {
      await context.close();
    }
  }
}

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

test('iPhone 14 landing screens, light and dark', async ({ browser }) => {
  await captureDevice(browser, dashboard.baseUrl, 'iphone14');
});

test('Pixel 7 landing screens, light and dark', async ({ browser }) => {
  await captureDevice(browser, dashboard.baseUrl, 'pixel7');
});
