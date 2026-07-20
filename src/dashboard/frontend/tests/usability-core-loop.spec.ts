/**
 * PAN-2908 · C-SIMPLE e2e — the junior-dev core loop (§5 success metric).
 *
 * Scripted usability run against the LIVE dashboard (localhost:3011), in
 * simple mode (the default UI). Proves the loop a first-week dev completes
 * with no walkthrough:
 *
 *   1. home answers "what is it doing · does it need me · is it done"
 *      with plain-words sections, and nothing internal leaks (zero banned
 *      words in chrome);
 *   2. handing off a task starts a seeded DISCUSSION (description + model +
 *      "don't file until I say so" prompt) — not a dead-end tracker form;
 *   3. any issue page shows the steps track, AT MOST one primary action,
 *      no destructive controls, and zero banned words outside the live
 *      transcript (agent output is content, not chrome).
 *
 * Run with the dashboard up: `npx playwright test tests/usability-core-loop.spec.ts`.
 * Not part of the unit suite — it needs the live app.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { BANNED_WORDS } from '../src/lib/simple/strings';

const BASE = process.env.OVERDECK_DASHBOARD_URL ?? 'http://localhost:3011';

/** The complete set of simple-mode primary-action labels (one per state). */
const PRIMARY_ACTION_LABELS = [
  'Merge to main',
  'Start work',
  'Get it unstuck',
  'Tell the agent to fix them',
  'See what changed',
  'Answer',
];

const DESTRUCTIVE_RE = /stop|wipe|reset|destroy|kill|delete/i;

async function gotoSimple(page: Page, path: string) {
  await page.addInitScript(() => {
    try { localStorage.setItem('overdeck:ui-mode', 'simple'); } catch { /* ignore */ }
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
}

/**
 * Banned-word hits in CHROME text under `scope`: headings, input placeholders,
 * and aria/title attributes. Card titles, question subjects, and transcript
 * content are user/agent/tracker DATA — the copy contract covers the UI's own
 * vocabulary (catalog-rendered chrome), not their content.
 */
async function bannedWordsIn(scope: Locator): Promise<string[]> {
  const chromeText = await scope.evaluate((root) => {
    const chunks: string[] = [];
    for (const el of Array.from(root.querySelectorAll('h1, h2, h3'))) {
      chunks.push(el.textContent ?? '');
    }
    for (const el of Array.from(root.querySelectorAll('[placeholder]'))) {
      chunks.push(el.getAttribute('placeholder') ?? '');
    }
    for (const el of Array.from(root.querySelectorAll('[aria-label], [title]'))) {
      chunks.push(el.getAttribute('aria-label') ?? '');
      chunks.push(el.getAttribute('title') ?? '');
    }
    return chunks.join('\n');
  });
  const hits: string[] = [];
  for (const re of BANNED_WORDS) {
    const match = chromeText.match(re);
    if (match) hits.push(match[0]);
  }
  return hits;
}

test('simple home renders the three questions in plain words, zero jargon', async ({ page }) => {
  await gotoSimple(page, '/');
  const home = page.locator('[data-component="simple-home-page"]');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000); // snapshot + bootstrap settle

  // The three questions: does it need me · what is it doing · is it done.
  // (Section h2s carry a count span, so match with hasText, not exact text.)
  await expect(home.locator('h2', { hasText: 'Needs you' })).toBeVisible();
  await expect(home.locator('h2', { hasText: 'Working now' })).toBeVisible();
  // "Ready to merge" as a section only renders when non-empty; the summary
  // metric line always answers "is it done".
  await expect(home.getByText(/ready to merge/).first()).toBeVisible();

  // The composer is the front door, in plain words.
  await expect(home.getByTestId('talk-it-through-input')).toHaveAttribute('placeholder', /plain words/);

  expect(await bannedWordsIn(home)).toEqual([]);
});

test('handing off a task starts a seeded discussion, not a tracker form', async ({ page }) => {
  let posted: { model?: string; harness?: string; message?: string; projectKey?: string } | null = null;
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON() as typeof posted;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'usability-e2e-run' }) });
  });

  await gotoSimple(page, '/');
  const home = page.locator('[data-component="simple-home-page"]');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);

  const description = 'make the weekly digest video resumable after a crash';
  await home.getByTestId('talk-it-through-input').fill(description);
  await home.getByRole('button', { name: 'Talk it through' }).click();

  // We leave simple mode for the new conversation — the AI discusses first.
  await page.waitForURL('**/conv/usability-e2e-run**', { timeout: 15_000 });

  expect(posted, 'composer never POSTed /api/conversations').not.toBeNull();
  expect(posted!.message).toContain(description);
  expect(posted!.message).toContain('do not file anything yet');
  expect(posted!.message).toContain('Only when I explicitly say it is ready');
  expect(typeof posted!.model).toBe('string');
  expect((posted!.model ?? '').length).toBeGreaterThan(0);
});

test('an issue page has the steps, at most one primary action, no destructive controls', async ({ page }) => {
  await gotoSimple(page, '/');
  const home = page.locator('[data-component="simple-home-page"]');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);

  // Open the first issue the home surfaces (any state proves the invariants);
  // fall back to a known historical issue when home is empty.
  const identifier = await home.evaluate((root) => {
    const spans = Array.from(root.querySelectorAll('span.font-mono'));
    for (const span of spans) {
      const text = (span.textContent ?? '').trim();
      if (/^[A-Z]+-\d+$/.test(text)) return text;
    }
    return null;
  });
  const target = identifier ?? 'PAN-2377';

  await gotoSimple(page, `/issues/${encodeURIComponent(target)}`);
  const issuePage = page.locator('[data-component="simple-issue-page"]');
  await expect(issuePage).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);

  // The four-word progress track.
  for (const step of ['Started', 'Writing code', 'Checking', 'Ready']) {
    await expect(issuePage.getByText(step, { exact: true }).first()).toBeVisible();
  }

  // The conversation section is always present.
  await expect(issuePage.getByText("What it's saying and doing", { exact: true })).toBeVisible();

  // At most ONE primary action across the page (unit snapshots prove
  // exactly-one per state; e2e guards the rule against live data).
  let primaryCount = 0;
  for (const label of PRIMARY_ACTION_LABELS) {
    primaryCount += await issuePage.getByRole('button', { name: label, exact: true }).count();
  }
  expect(primaryCount, 'simple issue page must never offer more than one primary action').toBeLessThanOrEqual(1);

  // Destructive controls are unreachable in simple mode.
  const names = await issuePage.getByRole('button').allTextContents();
  expect(names.filter((n) => DESTRUCTIVE_RE.test(n))).toEqual([]);

  expect(await bannedWordsIn(issuePage)).toEqual([]);
});
