import { test, expect, type Page, type Route } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

/**
 * PAN-4508 — Settings → Background AI's Jev controls (route/model/timeout) and the
 * per-feature usage readout.
 *
 * Runs against an isolated dashboard (its own temp OVERDECK_HOME and port, no
 * Deacon — see fixtures/isolated-dashboard.ts) so the real app shell, session
 * bootstrap and WebSocket all come up against a self-consistent origin; the
 * live dashboard on 3011 rejects a mismatched origin's session bootstrap with
 * 403 and never renders past the home view. `npm run build` first — the
 * fixture serves the built frontend from `dist`.
 *
 * The three jev-specific routes are still stubbed via page.route, exactly as
 * experimental-channels-toggle.spec.ts stubs /api/settings, so each test
 * controls its own fixture data without writing real config.yaml.
 */

const BASE_SETTINGS = {
  models: {
    providers: {
      anthropic: true,
      openai: false,
      google: false,
      minimax: false,
      zai: false,
      kimi: false,
      mimo: false,
      openrouter: false,
    },
    gemini_thinking_level: 3,
  },
  api_keys: {},
  tracker_keys: {},
  background_ai: { cheap_mode: false, features: { jevTurnEndAssessment: true } },
};

function jevUsageFixture(calls24h: number) {
  const emptyFeature = { calls24h: 0, lastCallAt: null, lastError: null };
  return {
    hours: 24,
    features: {
      jevTurnEndAssessment: {
        calls24h,
        lastCallAt: calls24h > 0 ? new Date(Date.now() - 60_000).toISOString() : null,
        lastError: null,
      },
      jevAcceptanceCriteriaReview: emptyFeature,
      jevMemoryRelevance: emptyFeature,
    },
  };
}

interface JevSettingsRouteOptions {
  initialView: Record<string, unknown>;
  usage: Record<string, unknown>;
  onPut?: (body: Record<string, unknown>) => void;
}

/** Stubs /api/settings, /api/jev/settings (stateful PUT→GET echo) and /api/jev/usage. */
async function mockJevSettings(page: Page, opts: JevSettingsRouteOptions): Promise<void> {
  let jevView = { ...opts.initialView };

  await page.route('**/api/settings', async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASE_SETTINGS) });
      return;
    }
    if (method === 'PUT' || method === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/jev/settings', async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jevView) });
      return;
    }
    if (method === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      opts.onPut?.(body);
      jevView = { ...jevView, ...body, configured: true };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jevView) });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/jev/usage', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.usage) }),
  );
}

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

async function gotoSettings(page: Page): Promise<void> {
  await page.goto(`${dashboard.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  const section = page.getByTestId('jev-settings-panel');
  await section.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await expect(section).toBeVisible({ timeout: 15_000 });
}

test.describe('Settings → Background AI — Jev controls (PAN-4508)', () => {
  test('editing the model saves it and shows the saved value after reload', async ({ page }) => {
    let lastPutBody: Record<string, unknown> | null = null;
    await mockJevSettings(page, {
      initialView: {
        configured: true,
        route: 'zen',
        baseUrl: 'https://opencode.ai/zen',
        model: 'jev-1.13-free',
        timeoutMs: 2000,
        apiKeyRef: 'TYPESAFE_API_KEY',
      },
      usage: jevUsageFixture(3),
      onPut: (body) => { lastPutBody = body; },
    });
    await gotoSettings(page);

    await page.getByTestId('jev-model-input').fill('jev-1.13');
    await expect.poll(() => lastPutBody, { timeout: 5_000 }).toMatchObject({
      route: 'zen',
      model: 'jev-1.13',
      timeoutMs: 2000,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const section = page.getByTestId('jev-settings-panel');
    await section.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await expect(page.getByTestId('jev-model-input')).toHaveValue('jev-1.13', { timeout: 15_000 });
  });

  test('clearing the model while a Jev feature is on blocks the save', async ({ page }) => {
    let putCount = 0;
    await mockJevSettings(page, {
      initialView: {
        configured: true,
        route: 'zen',
        baseUrl: 'https://opencode.ai/zen',
        model: 'jev-1.13-free',
        timeoutMs: 2000,
        apiKeyRef: 'TYPESAFE_API_KEY',
      },
      usage: jevUsageFixture(0),
      onPut: () => { putCount += 1; },
    });
    await gotoSettings(page);

    await page.getByTestId('jev-model-input').fill('');
    await expect(page.getByTestId('jev-settings-error')).toHaveText(
      'jev.model is required while a Jev feature is on',
    );
    await page.waitForTimeout(1_000);
    expect(putCount).toBe(0);
  });

  test('shows the 24h call count from the usage readout', async ({ page }) => {
    await mockJevSettings(page, {
      initialView: {
        configured: true,
        route: 'zen',
        baseUrl: 'https://opencode.ai/zen',
        model: 'jev-1.13-free',
        timeoutMs: 2000,
        apiKeyRef: 'TYPESAFE_API_KEY',
      },
      usage: jevUsageFixture(3),
    });
    await gotoSettings(page);

    await expect(page.getByTestId('jev-usage-jevTurnEndAssessment')).toContainText('3 calls in 24h');
  });
});
