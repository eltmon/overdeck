/**
 * PAN-4198 (FR-12 / AC-6) — screenshots of the trimmed issue action menu.
 *
 * Three derived states × two themes, written to `docs/images/pan-4198/` and
 * linked from the PR description. `test-results/` is gitignored and GitHub has
 * no API for putting an image into a PR body, so the PNGs are committed.
 *
 * The menu is opened by right-clicking a Pipeline row. WI-6 named the project
 * tree first and a Kanban card as the fallback; both were tried and neither
 * worked under the stub. The tree needs `/api/registered-projects` to return a
 * real project, and on a Kanban card the popover sits inside the column's
 * stacking context, which intercepts pointer events on the Danger row. A
 * Pipeline row opens the same IssueActionGroupedBody in a flat list.
 *
 * The dashboard is never contacted. `wsTransport.ts` is replaced with a stub
 * module, so this needs a Vite dev server — against a production bundle there is
 * no such module URL to intercept. Start one on an unused port first:
 *
 *   cd src/dashboard/frontend && npx vite --port 3910 --strictPort
 *   PAN_4198_BASE_URL=http://127.0.0.1:3910 npx playwright test tests/pan-4198-issue-menu.spec.ts
 *
 * Every `/api/**` call is routed to a stub, so nothing reaches the operator's
 * instance even though the dev server proxies /api to it.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PAN_4198_BASE_URL ?? 'http://127.0.0.1:3910';
const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = resolve(HERE, '../../../../docs/images/pan-4198');

const PROJECT = { id: 'overdeck', name: 'Overdeck', color: '#a855f7' };
const PR = { url: 'https://example.test/pr/1', number: 1, reviewState: 'changes-requested', checks: 'red', mergeable: false };

/** One card per state, so a single board render covers all three menus. */
const FIXTURES = [
  {
    slug: 'planned',
    issueId: 'PAN-4001',
    issue: {
      title: 'Planned work waiting to start', status: 'Todo', state: 'planned',
      hasPlan: true, hasTasks: true, workspacePath: '/tmp/feature-pan-4001',
    },
    derived: { state: 'planned' },
    agent: { status: 'stopped', role: 'plan' },
  },
  {
    slug: 'working',
    issueId: 'PAN-4002',
    issue: {
      title: 'Work in progress', status: 'In Progress', state: 'in_progress',
      hasPlan: true, hasTasks: true, workspacePath: '/tmp/feature-pan-4002',
    },
    derived: { state: 'working' },
    agent: { status: 'running', role: 'work' },
    pane: { role: 'work' },
  },
  {
    slug: 'changes-requested',
    issueId: 'PAN-4003',
    issue: {
      title: 'Reviewer asked for changes', status: 'In Review', state: 'in_review',
      hasPlan: true, hasTasks: true, workspacePath: '/tmp/feature-pan-4003',
    },
    derived: { state: 'changes-requested', pr: PR },
    agent: { status: 'stopped', role: 'work' },
  },
] as const;

function snapshotPayload() {
  return {
    sequence: 1,
    specialists: [],
    channelPermissionRequests: [],
    timestamp: new Date().toISOString(),
    issues: FIXTURES.map((fixture) => ({
      id: fixture.issueId,
      identifier: fixture.issueId,
      description: '',
      priority: 2,
      labels: [],
      url: `https://example.test/issues/${fixture.issueId}`,
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
      project: PROJECT,
      source: 'github',
      ...fixture.issue,
    })),
    agents: FIXTURES.map((fixture) => ({
      id: `agent-${fixture.issueId.toLowerCase()}`,
      issueId: fixture.issueId,
      runtime: 'claude-code',
      harness: 'claude-code',
      model: 'claude-opus-5',
      startedAt: '2026-09-25T00:00:00.000Z',
      consecutiveFailures: 0,
      killCount: 0,
      ...fixture.agent,
    })),
    derivedIssueStates: FIXTURES.map((fixture) => ({ issueId: fixture.issueId, ...fixture.derived })),
    backendPanes: FIXTURES.flatMap((fixture) => ('pane' in fixture && fixture.pane
      ? [{
        id: `pane-${fixture.issueId.toLowerCase()}`,
        issue: fixture.issueId,
        harness: 'claude-code',
        model: 'claude-opus-5',
        state: 'working',
        ...fixture.pane,
      }]
      : [])),
  };
}

/**
 * Transitions make the popover fail Playwright's stability check when we click
 * inside it, and they make screenshots non-deterministic. Kill both.
 */
async function freezeAnimations(page: Page) {
  await page.addStyleTag({ content: `
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}
` });
}

async function installMockTransport(page: Page) {
  await page.route('**/src/lib/wsTransport.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
const snapshot = ${JSON.stringify(snapshotPayload())};
const transport = {
  request: async () => snapshot,
  requestStream: async () => undefined,
  subscribe: () => () => undefined,
  dispose: () => undefined,
};
export function getTransport() { return transport; }
export function resetTransport() {}
export function ensureDashboardSession() { return Promise.resolve(); }
export async function dashboardMutationJsonHeaders() { return { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test-csrf' }; }
export class WsTransport {}
`,
  }));
}

async function routeDashboardApis(page: Page) {
  // Catch-all first; the specific shapes below override it. It answers `[]`
  // because most unstubbed dashboard endpoints are list endpoints whose
  // consumers call `.map`/`.filter` straight off the payload — `{}` trips the
  // error boundary before the board ever renders. Object-shaped endpoints are
  // each given their real shape below.
  await page.route('**/api/**', route => route.fulfill({ json: [] }));
  await page.route('**/api/orders', route => route.fulfill({ json: { books: [] } }));
  await page.route('**/api/costs/stream**', route => route.fulfill({ json: { events: [], eventsByIssue: {}, totalCost: 0 } }));
  await page.route('**/api/registered-projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/conversations', route => route.fulfill({ json: [] }));
  await page.route('**/api/confirmations', route => route.fulfill({ json: [] }));
  await page.route('**/api/specialists', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/costs/by-issue', route => route.fulfill({ json: { issues: [] } }));
  await page.route('**/api/version', route => route.fulfill({ json: { version: 'test' } }));
  await page.route('**/api/tracker-status', route => route.fulfill({ json: { primary: 'github', configured: [] } }));
  await page.route('**/api/settings', route => route.fulfill({ json: { tts: { enabled: false, mutedIssues: [] } } }));
  await page.route('**/api/settings/available-models', route => route.fulfill({ json: {} }));
  await page.route('**/api/agents/**/has-session', route => route.fulfill({ json: { lifecycle: { canResumeSession: true } } }));
  await page.route('**/api/metrics/summary', route => route.fulfill({ json: {
    today: { totalCost: 0, agentCount: 0, activeCount: 0, stuckCount: 0, warningCount: 0 },
    topSpenders: { agents: [], issues: [] },
  } }));
  await page.route('**/api/cliproxy/status', route => route.fulfill({ json: { running: true, pid: 1, checkedAt: new Date().toISOString() } }));
  await page.route('**/api/cloister/**', route => route.fulfill({ json: {
    running: false, lastCheck: null,
    summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 },
    agentsNeedingAttention: [],
  } }));
  // The health strip renders eagerly and throws on a partial payload, so it gets
  // the full shape rather than the catch-all's `{}`.
  await page.route('**/api/system/health', route => route.fulfill({ json: {
    severity: 'normal',
    updatedAt: new Date().toISOString(),
    summary: {
      cpuPercent: 0, loadAverage1m: 0, loadPerCore1m: 0,
      totalMemoryBytes: 1, usedMemoryBytes: 0, availableMemoryBytes: 1, memoryUsedPercent: 0,
      swapTotalBytes: 0, swapUsedBytes: 0, swapUsedPercent: 0, overcommitPercent: 0,
      agentCount: 0, workAgentCount: 0, planningAgentCount: 0,
      specialistSessionCount: 0, leakedSpecialistCount: 0,
      containerCount: 0, containerMemoryBytes: 0,
    },
    thresholds: {
      memoryAvailableWarningBytes: 0, memoryAvailableCriticalBytes: 0,
      swapUsedWarningPercent: 0, swapUsedCriticalPercent: 0,
      cpuLoadWarningPerCore: 0, cpuLoadCriticalPerCore: 0,
      overcommitWarningPercent: 0, overcommitCriticalPercent: 0,
    },
    reasons: [], agents: [], leakedSpecialists: [], topConsumers: [],
  } }));
}

/** The app's own scheme (`useTheme`): dark is the `dark` class, light is its absence. */
async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, theme);
  await page.waitForTimeout(200);
}

const CLIP_PAD = 28;

function padded(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  const x = Math.max(0, box.x - CLIP_PAD);
  const y = Math.max(0, box.y - CLIP_PAD);
  return {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + CLIP_PAD * 2),
    height: Math.min(viewport.height - y, box.height + CLIP_PAD * 2),
  };
}

function pipelineRow(page: Page, issueId: string) {
  return page.locator(`[data-component="issue-row"][data-issue-id="${issueId}"]`);
}

/** Right-click the row, then expand Danger so the full menu is in frame. */
async function openMenu(page: Page, issueId: string) {
  const row = pipelineRow(page, issueId);
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: 'right' });

  // The popover is `z-[1000]` but sits inside the row's stacking context, so the
  // rows *after* it in DOM order paint over it. Raise this row and hide its
  // siblings for the capture — presentational only, and it changes nothing about
  // what the menu itself renders. (The Pipeline surface's z-order is worth a
  // follow-up; it is not part of this registry change.)
  await row.evaluate((element) => {
    const host = element as HTMLElement;
    host.style.position = 'relative';
    host.style.zIndex = '60';
    for (const other of document.querySelectorAll<HTMLElement>('[data-component="issue-row"]')) {
      if (other !== host) other.style.visibility = 'hidden';
    }
  });

  // Menu-open state is global and keyed per menu, so a menu left over from the
  // previous fixture would still be mounted. Exactly one must be on screen.
  const menu = page.getByTestId('issue-action-overflow-menu');
  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
  // Park the pointer so no hover affordance paints over the menu.
  await page.mouse.move(4, 4);

  const danger = menu.getByRole('menuitem', { name: 'Danger' });
  if (await danger.count()) {
    // dispatchEvent, not click: the sticky phase header overlaps the row at this
    // point and Playwright's hit test refuses. Whether the disclosure responds to
    // a real click is covered by IssueActionContextMenu.test.tsx; here we only
    // need it open so the Danger rows are in the screenshot.
    await danger.first().dispatchEvent('click');
    await expect(menu.locator('[data-issue-action-section="danger"]')).toBeVisible();
  }
  // MenuSurface focuses its first item on open, and that focus scroll leaves the
  // surface scrolled a few pixels right — enough to shave the first character
  // off every label in the capture. `overflow-x-hidden` hides the scrollbar, not
  // the offset.
  await menu.evaluate((element) => { element.scrollLeft = 0; });
  return menu;
}

test.describe('PAN-4198 trimmed issue action menu', () => {
  // A fresh, empty storage state per run: never another agent's browser profile.
  // The viewport is tall so the whole menu fits in one frame. The drawer is
  // `fixed`, so a menu running past the fold cannot be scrolled to — Playwright
  // captures a shifted, clipped box instead.
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 1600 } });

  test('captures the menu for three derived states in both themes', async ({ page }) => {
    await mkdir(IMAGE_DIR, { recursive: true });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMockTransport(page);
    await routeDashboardApis(page);

    await page.goto(`${BASE_URL}/pipeline`);
    try {
      await expect(pipelineRow(page, FIXTURES[0].issueId)).toBeVisible({ timeout: 30_000 });
    } catch (cause) {
      throw new Error(`Board never rendered. Page errors: ${pageErrors.join(' | ') || 'none'}`, { cause });
    }
    await freezeAnimations(page);

    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      for (const fixture of FIXTURES) {
        const menu = await openMenu(page, fixture.issueId);

        // The whole point of the trim: nothing gated, nothing counted.
        await expect(menu).not.toHaveText(/available now/);
        await expect(menu.locator('[data-testid^="issue-action-disabled-"]')).toHaveCount(0);

        // Clip a viewport shot rather than calling `menu.screenshot()`: the
        // surface is repositioned by `useViewportConstraint` after layout, so
        // its reported box sits a little right of where it actually paints and
        // an element-relative capture shaves the left edge off every label. The
        // pad covers that offset and frames the menu.
        const box = await menu.boundingBox();
        expect(box, `${fixture.slug}-${theme} menu has no box`).not.toBeNull();
        await page.screenshot({
          path: `${IMAGE_DIR}/${fixture.slug}-${theme}.png`,
          clip: padded(box!, page.viewportSize()!),
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
          for (const other of document.querySelectorAll<HTMLElement>('[data-component="issue-row"]')) {
            other.style.visibility = '';
            other.style.zIndex = '';
          }
        });
        await page.waitForTimeout(150);
      }
    }
  });
});
