import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3012'; // Vite dev server port

// All tabs to screenshot
const TABS = [
  { id: 'kanban', label: 'Board' },
  { id: 'agents', label: 'Agents' },
  { id: 'handoffs', label: 'Handoffs' },
  { id: 'activity', label: 'Activity' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'costs', label: 'Costs' },
  { id: 'skills', label: 'Skills' },
  { id: 'health', label: 'Health' },
  { id: 'settings', label: 'Settings' },
];

test.describe('Theme Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the dashboard
    await page.goto(BASE_URL);
    // Wait for the page to load
    await page.waitForSelector('header', { timeout: 10000 });
  });

  test('Dark Mode - All Tabs', async ({ page }) => {
    // Ensure dark mode is active (it's the default)
    const html = await page.locator('html');
    const hasLightClass = await html.evaluate(el => el.classList.contains('light'));

    // If light mode is active, toggle to dark
    if (hasLightClass) {
      await page.click('button[title*="dark mode"]');
      await page.waitForTimeout(300); // Wait for transition
    }

    // Screenshot each tab
    for (const tab of TABS) {
      // Click the tab
      await page.click(`button:has-text("${tab.label}")`);
      await page.waitForTimeout(500); // Wait for content to render

      // Take screenshot
      await page.screenshot({
        path: `theme-screenshots/dark-${tab.id}.png`,
        fullPage: true
      });

      console.log(`✓ Dark mode screenshot: ${tab.id}`);
    }
  });

  test('Light Mode - All Tabs', async ({ page }) => {
    // Toggle to light mode
    const html = await page.locator('html');
    const hasLightClass = await html.evaluate(el => el.classList.contains('light'));

    if (!hasLightClass) {
      // Click the theme toggle button (Sun/Moon icon)
      const themeButton = page.locator('button').filter({
        has: page.locator('svg.lucide-sun, svg.lucide-moon')
      });
      await themeButton.click();
      await page.waitForTimeout(300); // Wait for transition
    }

    // Verify light mode is active
    const nowHasLightClass = await html.evaluate(el => el.classList.contains('light'));
    expect(nowHasLightClass).toBe(true);

    // Screenshot each tab
    for (const tab of TABS) {
      // Click the tab
      await page.click(`button:has-text("${tab.label}")`);
      await page.waitForTimeout(500); // Wait for content to render

      // Take screenshot
      await page.screenshot({
        path: `theme-screenshots/light-${tab.id}.png`,
        fullPage: true
      });

      console.log(`✓ Light mode screenshot: ${tab.id}`);
    }
  });

  test('Theme Toggle Works', async ({ page }) => {
    const html = await page.locator('html');

    // Get initial state
    const initiallyLight = await html.evaluate(el => el.classList.contains('light'));

    // Click theme toggle
    const themeButton = page.locator('button').filter({
      has: page.locator('svg.lucide-sun, svg.lucide-moon')
    });
    await themeButton.click();
    await page.waitForTimeout(300);

    // Verify state changed
    const afterToggle = await html.evaluate(el => el.classList.contains('light'));
    expect(afterToggle).toBe(!initiallyLight);

    // Toggle back
    await themeButton.click();
    await page.waitForTimeout(300);

    // Verify state changed back
    const afterSecondToggle = await html.evaluate(el => el.classList.contains('light'));
    expect(afterSecondToggle).toBe(initiallyLight);
  });
});
