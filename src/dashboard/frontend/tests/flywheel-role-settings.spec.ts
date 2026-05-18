import { test, expect, Route } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3010';

const baseSettings = {
  workhorses: {
    expensive: 'claude-opus-4-7',
    mid: 'claude-sonnet-4-6',
    cheap: 'claude-haiku-4-5',
  },
  roles: {
    plan: { model: 'workhorse:expensive' },
    work: { model: 'workhorse:mid' },
    review: { model: 'workhorse:expensive' },
    test: { model: 'workhorse:mid' },
    ship: { model: 'workhorse:mid' },
    flywheel: {
      harness: 'claude-code',
      model: 'claude-opus-4-7',
      effort: 'high',
      maxAgents: 8,
      scope: 'pan-only',
    },
  },
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
  },
  api_keys: {},
  tracker_keys: {},
};

test.describe('Settings Roles — Flywheel row', () => {
  test('persists flywheel scope and reloads the saved snapshot', async ({ page }) => {
    let settings = structuredClone(baseSettings);

    await page.route('**/api/settings', async (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
        return;
      }
      if (method === 'PUT' || method === 'POST') {
        settings = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/settings/available-models', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        anthropic: [{ id: 'claude-opus-4-7', name: 'Claude Opus 4.7', costPer1MTokens: 45 }],
      }),
    }));
    await page.route('**/api/settings/openrouter/models', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [], favorites: [] }),
    }));
    await page.route('**/api/settings/claude-auth', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        installed: true,
        loggedIn: false,
        expired: false,
        subscriptionType: null,
        rateLimitTier: null,
        expiresAt: null,
        hasAnthropicApiKey: false,
      }),
    }));
    await page.route('**/api/voice/settings', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stt: {
          provider: 'moonshine',
          moonshine: { model: 'base' },
          googleCloud: { apiKey: '', model: 'latest_long' },
        },
        autopreso: { provider: 'openai', model: 'gpt-4.1-mini' },
      }),
    }));
    await page.route('**/api/tts/health', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, running: false, pid: null, daemonHost: '127.0.0.1', daemonPort: 5000 }),
    }));
    await page.route('**/api/tts/voices', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }));

    await page.goto(DASHBOARD_URL);
    const settingsBtn = page.locator('button:has-text("Settings")').first();
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
    }

    const flywheelCard = page.getByTestId('role-card').filter({ has: page.getByRole('heading', { name: 'Flywheel' }) });
    await expect(flywheelCard).toBeVisible({ timeout: 15_000 });
    await expect(flywheelCard.getByText('Changes apply on the next tick — no restart needed.')).toBeVisible();

    await flywheelCard.getByLabel('Flywheel scope').selectOption('all-tracked-projects');
    await expect.poll(() => settings.roles.flywheel.scope, { timeout: 5_000 }).toBe('all-tracked-projects');

    await page.reload();
    await expect(flywheelCard.getByLabel('Flywheel scope')).toHaveValue('all-tracked-projects');
    await expect(flywheelCard).toContainText('Flywheel');
    await expect(flywheelCard).toContainText('Changes apply on the next tick — no restart needed.');
  });
});
