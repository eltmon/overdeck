/**
 * PAN-5045 — the phone's Conversations tab groups rows by project, collapsed
 * by default, with a `+` next to each project header to start a conversation
 * there. Proved at 390×844 on an isolated dashboard (its own temp
 * `OVERDECK_HOME` and port, no Deacon), never the operator's live one.
 * `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * Screenshots land in test-results/pan-5045/ and are copied into
 * apps/mobile/acceptance/ for ACCEPTANCE.md.
 */

import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-5045';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

let dashboard: IsolatedDashboard | undefined;

test.setTimeout(120_000);

test.afterEach(async () => {
  await dashboard?.stop();
  dashboard = undefined;
});

function conversationRow(id: number, title: string, lastActivityAt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `pan-5045-conv-${id}`,
    title,
    status: 'active',
    issueId: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastAttachedAt: null,
    lastActivityAt,
    sessionAlive: true,
    tmuxSession: `conv-pan-5045-${id}`,
    cwd: '/tmp',
    endedAt: null,
    ...extra,
  };
}

const ROWS = [
  conversationRow(1, 'Alpha One', '2026-11-01T06:00:00.000Z', { cwd: '/tmp/alpha/sub1' }),
  conversationRow(2, 'Alpha Two', '2026-11-01T05:00:00.000Z', { cwd: '/tmp/alpha/sub2' }),
  conversationRow(3, 'Beta One', '2026-11-01T04:00:00.000Z', { projectKey: 'beta', cwd: '/tmp/elsewhere-beta' }),
  conversationRow(4, 'Elsewhere', '2026-11-01T03:00:00.000Z', { cwd: '/tmp/elsewhere' }),
];

const PROJECTS = [
  { key: 'alpha', name: 'alpha', path: '/tmp/alpha' },
  { key: 'beta', name: 'beta', path: '/tmp/beta' },
];

test('groups by project, starts collapsed, and + starts a conversation', async ({ browser }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  dashboard = await startIsolatedDashboard();
  const baseUrl = dashboard.baseUrl;

  const context = await browser.newContext(PHONE);
  try {
    const page = await context.newPage();

    const posted: Array<Record<string, unknown>> = [];
    const created = conversationRow(99, 'New conversation', '2026-11-01T07:00:00.000Z', { projectKey: 'beta', cwd: '/tmp/beta' });

    await page.route('**/api/registered-projects', (route) => route.fulfill({ json: PROJECTS }));
    await page.route('**/api/conversations', async (route) => {
      if (route.request().method() === 'POST') {
        posted.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({ json: created });
        return;
      }
      await route.fulfill({ json: ROWS });
    });
    await page.route('**/api/conversations/99', (route) => route.fulfill({ json: created }));

    await page.goto(`${baseUrl}/m?tab=conversations`, { waitUntil: 'domcontentloaded' });

    const region = page.getByRole('region', { name: 'Conversations' });
    await expect(region).toBeVisible({ timeout: 30_000 });

    const toggles = region.getByRole('button', { name: /^(alpha|beta|No project)/ });
    await expect(toggles).toHaveCount(3);
    for (const toggle of await toggles.all()) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    await page.screenshot({ path: `${SHOT_DIR}/groups-collapsed.png` });

    await region.getByRole('button', { name: /^alpha/ }).click();
    const alphaList = page.getByRole('list', { name: 'alpha' });
    await expect(alphaList.getByText('Alpha One')).toBeVisible();
    await expect(alphaList.getByText('Alpha Two')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/groups-expanded.png` });

    await page.getByRole('button', { name: 'New conversation in beta' }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toEqual({ projectKey: 'beta' });
    await expect(page).toHaveURL(/\/m\?conversation=99$/);
  } finally {
    await context.close();
  }
});
