/**
 * PAN-4754 — the operator decision dialog, proved on an isolated dashboard
 * (its own temp `OVERDECK_HOME` and port, no Deacon), never the operator's live
 * one. `npm run build` first: the fixture serves the built frontend from `dist`.
 *
 * A mocked conversation row in `/api/conversations/pending-input` opens the
 * dialog. The spec checks the question renders as markdown paragraphs, the
 * context renders apart from it, a `- **<label>:**` line lifts under its
 * option, multiSelect options are checkboxes and keyboard focus is visible.
 * Light and dark screenshots of each land in test-results/pan-4754/.
 */

import { mkdirSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

const SHOT_DIR = 'test-results/pan-4754';
const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

let dashboard: IsolatedDashboard | undefined;

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
  dashboard = undefined;
});

interface DecisionQuestion {
  question: string;
  context?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

function decisionRow(name: string, question: DecisionQuestion) {
  return {
    name,
    title: 'Close out the live check',
    issueId: null,
    harness: 'claude-code',
    pendingInputKinds: ['askUserQuestion'],
    pendingAskUserQuestion: {
      toolUseId: `operator-decision:${name}`,
      askedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      questions: [question],
    },
  };
}

const DECISION: DecisionQuestion = {
  question: 'The live check cannot run until this branch is released.\n\nHow should I close out?',
  context: '- The rig has no Overdeck installed.\n- A Fly VM installs the published version.\n- Both checks need the release.',
  options: [{ label: 'Close out now' }, { label: 'Rig only' }, { label: 'Hold until after merge' }],
};

const LIFTED: DecisionQuestion = {
  question: 'How should I close out?',
  context: '- The rig has no Overdeck installed.\n- **Close out now:** I cancel the live-check criteria and run pan done.\n- **Hold:** the issue stays open and you run the check yourself.',
  options: [{ label: 'Close out now' }, { label: 'Hold' }],
};

const MULTI: DecisionQuestion = {
  question: 'Which checks should run after the release?',
  multiSelect: true,
  options: [{ label: 'Rig' }, { label: 'Fly VM' }, { label: 'Phone shell' }],
};

/** Open the dashboard in a fresh context with one pending decision in the given theme. */
async function openDecision(browser: Browser, theme: Theme, row: ReturnType<typeof decisionRow>): Promise<Page> {
  const context = await browser.newContext({ ...DESKTOP });
  await context.addInitScript((value) => {
    try { window.localStorage.setItem('overdeck.ui.theme', value); } catch { /* storage blocked */ }
  }, theme);
  const page = await context.newPage();
  await page.route('**/api/conversations/pending-input', (route) => route.fulfill({ json: [row] }));
  await page.goto(`${dashboard!.baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60_000 });
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  return page;
}

async function shoot(page: Page, name: string, theme: Theme): Promise<void> {
  await page.getByRole('dialog').screenshot({ path: `${SHOT_DIR}/${name}-${theme}.png` });
  await page.context().close();
}

for (const theme of THEMES) {
  test(`renders the question as markdown and the context apart (${theme})`, async ({ browser }) => {
    const page = await openDecision(browser, theme, decisionRow('pan-4754-decision', DECISION));
    const dialog = page.getByRole('dialog');

    await expect(dialog.locator('li')).toHaveCount(3);
    const questionId = await dialog.getAttribute('aria-describedby');
    const question = dialog.locator(`[id="${questionId}"]`);
    await expect(question.locator('p')).toHaveCount(2);
    await expect(question.locator('p').first()).toHaveText('The live check cannot run until this branch is released.');
    await expect(question.locator('p').nth(1)).toHaveText('How should I close out?');
    await expect(question).not.toContainText('Fly VM');
    await expect(dialog.getByText('Agent\'s notes')).toBeVisible();
    await expect(dialog.locator('li', { hasText: 'A Fly VM installs the published version.' })).toBeVisible();

    await shoot(page, 'decision-dialog', theme);
  });

  test(`lifts option consequences under their options (${theme})`, async ({ browser }) => {
    const page = await openDecision(browser, theme, decisionRow('pan-4754-lifted', LIFTED));
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('radio', { name: /Close out now/ })).toContainText('I cancel the live-check criteria and run pan done.');
    await expect(dialog.getByRole('radio', { name: /^Hold/ })).toContainText('the issue stays open and you run the check yourself.');
    await expect(dialog.locator('li')).toHaveCount(1);

    await shoot(page, 'decision-dialog-consequences', theme);
  });

  test(`renders a multiSelect question as checkboxes (${theme})`, async ({ browser }) => {
    const page = await openDecision(browser, theme, decisionRow('pan-4754-multi', MULTI));
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('checkbox')).toHaveCount(3);
    await dialog.getByRole('checkbox', { name: 'Rig' }).click();
    await dialog.getByRole('checkbox', { name: 'Phone shell' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Rig' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('checkbox', { name: 'Fly VM' })).toHaveAttribute('aria-checked', 'false');

    await shoot(page, 'decision-dialog-multiselect', theme);
  });

  test(`shows a visible focus ring on an option (${theme})`, async ({ browser }) => {
    const page = await openDecision(browser, theme, decisionRow('pan-4754-focus', DECISION));
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('radio', { name: 'Close out now' })).toBeFocused();
    await page.keyboard.press('Tab');
    const focused = dialog.getByRole('radio', { name: 'Rig only' });
    await expect(focused).toBeFocused();
    await expect(focused).toHaveCSS('box-shadow', /rgb/);

    await shoot(page, 'decision-dialog-focus', theme);
  });
}
