import { test, expect, Route } from '@playwright/test';

/**
 * Verifies the Experimental section on SettingsPage rendered for PAN-985:
 *   1. Section appears as the LAST visible section on the Settings page.
 *   2. The Claude Code Channels toggle defaults to off (matches GET /api/settings response).
 *   3. Toggling the switch issues a write to /api/settings with the expected body.
 *
 * Network is mocked via page.route so the test does not require a real dashboard
 * server; it loads against any running dashboard URL and stubs settings traffic.
 */

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3010';

test.describe('Experimental — Claude Code Channels toggle', () => {
  test('section is last on the page, defaults off, and persists on toggle', async ({ page }) => {
    let lastWrittenBody: unknown = null;

    const baseSettings = {
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
        overrides: {},
        gemini_thinking_level: 3,
      },
      api_keys: {},
      tracker_keys: {},
      experimental: { claudeCodeChannels: false },
    };

    await page.route('**/api/settings', async (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseSettings) });
        return;
      }
      if (method === 'PUT' || method === 'POST') {
        lastWrittenBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/settings/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );

    await page.goto(DASHBOARD_URL);
    const settingsBtn = page.locator('button:has-text("Settings")').first();
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
    }

    const section = page.getByTestId('experimental-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Section must be the last <section> in DOM order.
    const isLast = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('section'));
      const exp = document.querySelector('[data-testid="experimental-section"]');
      return sections.length > 0 && sections[sections.length - 1] === exp;
    });
    expect(isLast).toBe(true);

    const toggle = page.getByTestId('experimental-claude-code-channels-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect.poll(() => lastWrittenBody, { timeout: 5_000 }).toMatchObject({
      experimental: { claudeCodeChannels: true },
    });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
