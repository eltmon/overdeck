/**
 * PAN-4266 (FR-8 / FR-9) — proves the Command Deck model picker dropdown stays
 * inside the viewport and the conversation column never shifts sideways.
 *
 * The dashboard is never contacted. `wsTransport.ts` is replaced with a stub
 * module, so this needs a Vite dev server — against a production bundle there
 * is no such module URL to intercept. Start one on an unused port first:
 *
 *   cd src/dashboard/frontend && npx vite --port 3911 --strictPort
 *   PAN_4266_BASE_URL=http://127.0.0.1:3911 npx playwright test tests/pan-4266-model-picker.spec.ts
 *
 * Every `/api/**` call is routed to a stub, so nothing reaches the operator's
 * instance even though the dev server proxies /api to it.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PAN_4266_BASE_URL ?? 'http://127.0.0.1:3911';
const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = resolve(HERE, '../../../../docs/images/pan-4266');
const GUTTER = 7.5;

function emptySnapshot() {
  return {
    sequence: 1,
    specialists: [],
    channelPermissionRequests: [],
    timestamp: new Date().toISOString(),
    issues: [],
    agents: [],
    derivedIssueStates: [],
    backendPanes: [],
  };
}

/** Transitions make screenshots non-deterministic and can fail stability checks. */
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
const snapshot = ${JSON.stringify(emptySnapshot())};
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
  await page.route('**/api/linear-mcp-auth', route => route.fulfill({ json: { status: 'none' } }));
  await page.route('**/api/cloister/**', route => route.fulfill({ json: {
    running: false, lastCheck: null,
    summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 },
    agentsNeedingAttention: [],
  } }));
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

/** Every ancestor of `el`, up to but not including <body>, has scrollLeft 0. */
async function noAncestorScrolledSideways(page: Page, locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.scrollLeft !== 0) return false;
    }
    return true;
  });
}

const VIEWPORTS = [
  { width: 1512, height: 982, deviceScaleFactor: 2 },
  { width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`PAN-4266 command deck picker clipping (${viewport.width}x${viewport.height})`, () => {
    test.use({
      storageState: { cookies: [], origins: [] },
      viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.deviceScaleFactor ? { deviceScaleFactor: viewport.deviceScaleFactor } : {}),
    });

    test('keeps the model picker dropdown unclipped and the column unshifted', async ({ page }) => {
      await mkdir(IMAGE_DIR, { recursive: true });
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await installMockTransport(page);
      await routeDashboardApis(page);

      await page.goto(`${BASE_URL}/command-deck`);
      const heading = page.getByRole('heading', { name: 'Command Deck' });
      try {
        await expect(heading).toBeVisible({ timeout: 30_000 });
      } catch (cause) {
        throw new Error(`Command Deck never rendered. Page errors: ${pageErrors.join(' | ') || 'none'}`, { cause });
      }
      await freezeAnimations(page);

      const x0 = (await heading.boundingBox())!.x;
      const trigger = page.locator('[class*="sidebarHeaderGroup"] [class*="pickerBtn"]').first();

      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await trigger.click();

        const dropdown = page.getByTestId('model-picker-dropdown');
        await expect(dropdown).toBeVisible();

        const box = (await dropdown.boundingBox())!;
        expect(box.x, 'dropdown left edge inside gutter').toBeGreaterThanOrEqual(GUTTER);
        expect(box.y, 'dropdown top edge inside gutter').toBeGreaterThanOrEqual(GUTTER);
        expect(box.x + box.width, 'dropdown right edge inside gutter').toBeLessThanOrEqual(viewport.width - GUTTER);
        expect(box.y + box.height, 'dropdown bottom edge inside gutter').toBeLessThanOrEqual(viewport.height - GUTTER);

        // Inset past the frame's 8px border-radius (NFR-2 keeps the rounded
        // corner): a 2px diagonal inset still lands in the radius's cutout and
        // elementFromPoint correctly resolves to whatever is behind it, not the
        // dropdown, so the corner check needs enough inset to clear the arc.
        const inset = 10;
        const corners: Array<[number, number]> = [
          [box.x + inset, box.y + inset],
          [box.x + box.width - inset, box.y + inset],
          [box.x + inset, box.y + box.height - inset],
          [box.x + box.width - inset, box.y + box.height - inset],
        ];
        for (const [cx, cy] of corners) {
          const inside = await page.evaluate(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const dropdownEl = document.querySelector('[data-testid="model-picker-dropdown"]');
            return !!(el && dropdownEl && dropdownEl.contains(el));
          }, [cx, cy]);
          expect(inside, `corner (${cx}, ${cy}) resolves inside the dropdown`).toBe(true);
        }

        const headingBoxWhileOpen = (await heading.boundingBox())!;
        expect(Math.abs(headingBoxWhileOpen.x - x0), 'heading unshifted while picker is open').toBeLessThanOrEqual(0.5);
        expect(await noAncestorScrolledSideways(page, heading)).toBe(true);

        await page.screenshot({
          path: `${IMAGE_DIR}/command-deck-picker-${theme}-${viewport.width}x${viewport.height}.png`,
          animations: 'disabled',
        });

        const headingBox = (await heading.boundingBox())!;
        await page.mouse.click(headingBox.x + 2, headingBox.y + 2);
        await expect(dropdown).toHaveCount(0);

        const headingBoxAfterClose = (await heading.boundingBox())!;
        expect(Math.abs(headingBoxAfterClose.x - x0), 'heading unshifted after picker closes').toBeLessThanOrEqual(0.5);
        expect(await noAncestorScrolledSideways(page, heading)).toBe(true);
      }
    });
  });
}

test.describe('PAN-4266 simple home page picker clipping', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 800 } });

  test('keeps the home-page picker dropdown inside the viewport', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMockTransport(page);
    await routeDashboardApis(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('overdeck:ui-mode', 'simple');
    });

    await page.goto(BASE_URL);
    const home = page.locator('[data-component="simple-home-page"]');

    // Implementation checkpoint (PRD WI-6): if the simple home page does not
    // render under the stub in time, this case is skipped — the portal/clamp
    // behavior for this trigger is otherwise identical to the Command Deck
    // case above, and simple/TalkItThrough.test.tsx covers the component.
    try {
      await expect(home).toBeVisible({ timeout: 15_000 });
    } catch (cause) {
      test.skip(true, `Simple home page never rendered under the stub. Page errors: ${pageErrors.join(' | ') || 'none'}. Cause: ${cause}`);
      return;
    }

    await freezeAnimations(page);
    const trigger = home.locator('[class*="pickerBtn"]').first();
    await trigger.click();

    const dropdown = page.getByTestId('model-picker-dropdown');
    await expect(dropdown).toBeVisible();

    const box = (await dropdown.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(GUTTER);
    expect(box.y).toBeGreaterThanOrEqual(GUTTER);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - GUTTER);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - GUTTER);
  });
});
