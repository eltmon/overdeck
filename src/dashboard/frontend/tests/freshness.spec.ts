/**
 * PAN-2908 · C-FRESH e2e — no spinner fossils.
 *
 * Loads the main surfaces of a LIVE dashboard (localhost:3011) and asserts
 * that after the loading boundary timeout (8s + margin), no region still
 * shows a bare "Loading…" state: every region is data, a resolved empty
 * state, or the boundary's labeled "taking longer than usual · Retry".
 *
 * Run with the dashboard up: `npx playwright test tests/e2e/freshness.spec.ts`.
 * Not part of the unit suite — it needs the live app.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.OVERDECK_DASHBOARD_URL ?? 'http://localhost:3011';
const BOUNDARY_GRACE_MS = 12_000; // 8s boundary timeout + bootstrap delay + 1s tick, with margin

const SURFACES = [
  { name: 'board', path: '/board' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'home', path: '/' },
  { name: 'drawer', path: '/issues/PAN-2377' },
  { name: 'cockpit', path: '/command-deck/panopticon-cli/PAN-2377' },
];

for (const surface of SURFACES) {
  test(`no eternal spinners on ${surface.name}`, async ({ page }) => {
    await page.goto(`${BASE}${surface.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(BOUNDARY_GRACE_MS);

    // Bare loading text that is NOT wrapped in a boundary's unavailable state
    // is a fossil. Regions may legitimately show the boundary's retry state.
    const fossils = await page.evaluate(() => {
      const matches: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.textContent ?? '').trim();
        if (!/^loading\b/i.test(text)) continue;
        const el = node.parentElement;
        if (!el) continue;
        if (el.closest('[data-component="loading-boundary-unavailable"]')) continue;
        // Skeleton shapes (shimmer blocks) are fine — they resolve.
        if (el.closest('[class*="skeleton"]')) continue;
        matches.push(text.slice(0, 60));
      }
      return matches;
    });

    expect(fossils, `spinner fossils on ${surface.name}: ${fossils.join(' | ')}`).toEqual([]);
  });
}
