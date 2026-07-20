/**
 * PAN-2908 · C-THEME e2e — both themes, one token system (§3.8).
 *
 * The §3.9 theming gate for the NEW screens (simple mode included): every key
 * screen must render correctly in light AND dark scheme — theme tokens flip
 * the page background (no dark-only assumptions), the html.dark class tracks
 * the stored preference, and code/stream panels (xterm) stay dark in both
 * schemes per the style guide.
 *
 * Runs against the live dashboard like freshness.spec.ts:
 * `npx playwright test tests/theme-conformance.spec.ts`.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.OVERDECK_DASHBOARD_URL ?? 'http://localhost:3011';

const SCREENS = [
  { name: 'simple-home', path: '/', mode: 'simple', marker: '[data-component="simple-home-page"]' },
  { name: 'simple-issue', path: '/issues/PAN-2377', mode: 'simple', marker: '[data-component="simple-issue-page"]' },
  { name: 'board', path: '/board', mode: 'advanced', marker: '[data-testid^="issue-card-"]' },
  { name: 'drawer', path: '/issues/PAN-2377', mode: 'advanced', marker: '[data-component="issue-detail"]' },
  { name: 'cockpit', path: '/command-deck/panopticon-cli/PAN-2377', mode: 'advanced', marker: '[data-section="Header bar"]' },
] as const;

function luminance(rgb: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return -1;
  const [r, g, b] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function gotoThemed(page: Page, path: string, mode: string, scheme: 'light' | 'dark') {
  await page.addInitScript(([m, s]) => {
    try {
      localStorage.setItem('overdeck:ui-mode', m as string);
      localStorage.setItem('overdeck.ui.theme', s as string);
    } catch { /* ignore */ }
  }, [mode, scheme] as const);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} scheme`, () => {
    for (const screen of SCREENS) {
      test(`${screen.name} renders correctly`, async ({ page }) => {
        await gotoThemed(page, screen.path, screen.mode, scheme);
        await page.waitForTimeout(5000); // snapshot + bootstrap settle

        // 1. The screen renders (no crash, no eternal skeleton).
        await expect(page.locator(screen.marker).first()).toBeVisible({ timeout: 15_000 });

        // 2. html.dark tracks the stored preference.
        const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        expect(hasDarkClass).toBe(scheme === 'dark');

        // 3. The token system actually re-themes the page background —
        //    a dark-only assumption leaves the light scheme dark (and vice versa).
        const bgLum = await page.evaluate(() =>
          getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? getComputedStyle(document.body).backgroundColor
            : getComputedStyle(document.documentElement).backgroundColor,
        );
        const lum = luminance(bgLum);
        if (lum >= 0) {
          if (scheme === 'light') expect(lum, `page background should be light (got ${bgLum})`).toBeGreaterThan(0.5);
          else expect(lum, `page background should be dark (got ${bgLum})`).toBeLessThan(0.5);
        }

        // 4. Code/stream panels stay dark in BOTH schemes (style guide).
        const xtermLums = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.xterm')).map((el) => getComputedStyle(el).backgroundColor),
        );
        for (const rgb of xtermLums) {
          const l = luminance(rgb);
          if (l >= 0) expect(l, `xterm panel must stay dark in ${scheme} (got ${rgb})`).toBeLessThan(0.5);
        }
      });
    }
  });
}
