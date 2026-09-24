import { test, expect } from '@playwright/test';

const BASE = process.env.OVERDECK_DASHBOARD_URL ?? 'http://127.0.0.1:3011';

// PAN-3834: exercise the real long model label and badges. No agent is launched.
for (const width of [1280, 785, 390, 320]) {
  test(`Talk it through controls do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('overdeck:ui-mode', 'simple');
      localStorage.setItem('overdeck.ui.sidebarCollapsed', 'true');
      localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
      localStorage.removeItem('pan-settings-cache');
    });
    await page.route('**/api/settings', async (route) => {
      const response = await route.fetch();
      const settings = await response.json();
      settings.models.default_conversation_model = 'gpt-6-astra';
      settings.models.provider_harnesses = { ...settings.models.provider_harnesses, openai: 'codex' };
      settings.experimental = { ...settings.experimental, showHarnessModelPermutations: false };
      await route.fulfill({ response, json: settings });
    });
    await page.route('**/api/conversations', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ model: 'gpt-6-astra' });
      // Before picker settings load, an omitted harness lets the server resolve
      // provider routing. It must never send the old hardcoded claude-code value.
      expect([undefined, 'codex']).toContain(body.harness);
      await route.fulfill({ status: 503, json: { error: 'Conversation service unavailable. Try again.' } });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const home = page.locator('[data-component="simple-home-page"]');
    const input = home.getByTestId('talk-it-through-input');
    const project = home.getByTestId('talk-it-through-project');
    const picker = home.getByRole('button', { name: /GPT-6 Astra/ });
    const action = home.getByRole('button', { name: 'Talk it through', exact: true });
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await expect(project).toBeVisible();
    await input.fill('Discuss the weekly digest');
    await expect(action).toBeEnabled();
    await page.screenshot({ path: `/tmp/talk-it-through-${width}.png` });
    const controls = [input, project, picker, action];
    const bounds = await Promise.all(controls.map((control) => control.boundingBox()));
    for (let i = 0; i < bounds.length; i++) {
      const a = bounds[i]!;
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(width);
      for (let j = i + 1; j < bounds.length; j++) {
        const b = bounds[j]!;
        const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlaps, `controls ${i} and ${j} overlap`).toBe(false);
      }
    }
    const lineCount = await action.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getClientRects().length;
    });
    expect(lineCount).toBe(1);
    await picker.click();
    await expect(home.getByPlaceholder('Search models…')).toBeVisible();
    await input.click();
    await action.click();
    await expect(home.getByRole('alert')).toContainText('Conversation service unavailable');
    await expect(input).toHaveValue('Discuss the weekly digest');
    await expect(action).toBeEnabled();
  });
}
