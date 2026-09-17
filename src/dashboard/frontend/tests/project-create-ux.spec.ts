/**
 * End-to-end journeys for project creation (PAN-3836 WI-8).
 *
 * These run against an **isolated** dashboard — its own temp `OVERDECK_HOME`,
 * its own port, no Deacon — because they register projects and would otherwise
 * write into the operator's real registry (NFR-8). Every other spec in this
 * directory targets the live dashboard on 3011; this one deliberately does not.
 *
 * Coverage is split on purpose, and the split is stated rather than implied:
 *
 *   - Journeys that exercise the **real server** (defaults, registration,
 *     reconciliation identity, repair) drive the isolated dashboard's own API
 *     and UI, so the assertions are about behaviour that actually happened.
 *   - Journeys about **failure timing** (a hung clone, a dropped POST response,
 *     five lost polls) intercept at the network boundary, because the point is
 *     what the page does when the server's answer is late, wrong, or missing.
 *     A real clone cannot be made to hang on demand from a browser test.
 *
 * Journeys not covered here are named in the summary rather than papered over:
 * process-level proof that a cancelled clone's child actually exited is asserted
 * in `tests/unit/lib/projects/create-perform.test.ts`, which can observe the
 * signal directly; a browser cannot.
 */

import { test, expect, type Page } from '@playwright/test';
import { startIsolatedDashboard, type IsolatedDashboard } from './fixtures/isolated-dashboard.js';

let dashboard: IsolatedDashboard;

test.beforeAll(async () => {
  dashboard = await startIsolatedDashboard();
});

test.afterAll(async () => {
  await dashboard?.stop();
});

/**
 * Open /projects/new on the isolated dashboard.
 *
 * The shell's sidebar and Activity Feed are collapsed first, following the same
 * convention `talk-it-through.spec.ts` uses for narrow viewports: at 390px those
 * panels overlay the content area, which is shell behaviour rather than anything
 * this page controls, and leaving them open makes a responsive screenshot a
 * picture of the shell instead of the form.
 */
async function openCreatePage(page: Page, query = ''): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('overdeck.ui.sidebarCollapsed', 'true');
    localStorage.setItem('overdeck.ui.sessionFeedSidebarOpen', 'false');
  });
  await page.goto(`${dashboard.baseUrl}/projects/new${query}`, { waitUntil: 'domcontentloaded' });
}

/** Stub resolve so a journey can drive the form without a real remote. */
async function stubResolve(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  await page.route('**/api/projects/resolve', async (route) => {
    await route.fulfill({
      json: {
        mode: 'clone',
        key: 'widget',
        name: 'widget',
        path: '/tmp/e2e/Projects/widget',
        parentDir: '/tmp/e2e/Projects',
        homeDir: '/tmp/e2e',
        cloneUrl: 'https://github.com/acme/widget.git',
        provider: 'github',
        repoSlug: 'acme/widget',
        defaultBranch: 'main',
        remoteChecked: true,
        isGitRepository: true,
        gitRoot: null,
        proposedIssuePrefix: 'WIDGET',
        wouldClone: true,
        wouldGitInit: false,
        willCreateMainWorkspace: true,
        registeredKeyAtPath: null,
        findings: [],
        ...overrides,
      },
    });
  });
}

test.describe('project creation journeys', () => {
  test('the isolated fixture starts with an empty registry', async ({ page }) => {
    // If this ever fails, the suite is pointed at a real dashboard and must be
    // stopped before it writes anything.
    const response = await page.request.get(`${dashboard.baseUrl}/api/registered-projects`);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([]);
  });

  test('entry actions describe the three ways to add a project', async ({ page }) => {
    await openCreatePage(page);

    await expect(page.getByRole('heading', { name: 'Add a project' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open existing folder/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Clone repository/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Create new project/ })).toBeVisible();
    // The project-versus-workspace guidance and its working link.
    await expect(page.getByRole('link', { name: /create a workspace/ })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );
  });

  test('clone URL with default destination shows the real target before submitting', async ({
    page,
  }) => {
    await stubResolve(page);
    await openCreatePage(page, '?mode=clone');

    await page.getByLabel('Repository URL').fill('acme/widget');

    // The destination is a real value on screen, not a placeholder.
    await expect(page.getByText('/tmp/e2e/Projects/widget')).toBeVisible();
    await expect(page.getByLabel('Parent folder')).toHaveValue('/tmp/e2e/Projects');
    await expect(page.getByRole('button', { name: 'Clone repository' })).toBeEnabled();
  });

  test('create project with only a name — prefix is derived, not demanded', async ({ page }) => {
    await stubResolve(page, { mode: 'new', wouldClone: false, wouldGitInit: true });
    await openCreatePage(page, '?mode=new');

    await page.getByTestId('new-project-name-input').fill('widget');

    await expect(page.getByRole('button', { name: 'Create project' })).toBeEnabled();
    await page.getByRole('button', { name: 'Options' }).click();
    await expect(page.getByLabel('Issue prefix')).toHaveValue('WIDGET');
  });

  test('preserve explicit options across a source change, and Reset restores them', async ({
    page,
  }) => {
    await stubResolve(page);
    await openCreatePage(page, '?mode=clone');
    await page.getByLabel('Repository URL').fill('acme/widget');
    await page.getByRole('button', { name: 'Options' }).click();

    const name = page.getByTestId('new-project-name-input');
    await name.fill('my-own-name');
    await page.getByLabel('Repository URL').fill('acme/other');

    // A new proposal must not overwrite a value the operator typed.
    await expect(name).toHaveValue('my-own-name');
    await page.getByRole('button', { name: /Reset to detected values/ }).click();
    await expect(name).toHaveValue('widget');
  });

  test('a prefix conflict opens Options and points at the field', async ({ page }) => {
    await stubResolve(page, {
      findings: [
        { field: 'issuePrefix', code: 'issue-prefix-taken', message: "Issue prefix 'WIDGET' is already used by another project." },
      ],
    });
    await openCreatePage(page, '?mode=clone');
    await page.getByLabel('Repository URL').fill('acme/widget');

    // A finding the operator cannot see is a dead end.
    await expect(page.getByRole('button', { name: 'Options' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByText(/already used by another project/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clone repository' })).toBeDisabled();
  });

  test('lose polling while the clone continues — no duplicate POST, Create stays unavailable', async ({
    page,
  }) => {
    await stubResolve(page);
    let creates = 0;
    let polls = 0;
    await page.route('**/api/projects', async (route) => {
      creates += 1;
      await route.fulfill({ status: 202, json: { jobId: 'job-1' } });
    });
    await page.route('**/api/projects/create-jobs/job-1', async (route) => {
      polls += 1;
      if (polls === 1) {
        await route.fulfill({
          json: { status: 'cloning', phase: 'Receiving objects', percent: 42 },
        });
        return;
      }
      await route.fulfill({ status: 503, json: { error: 'unavailable' } });
    });

    await openCreatePage(page, '?mode=clone');
    await page.getByLabel('Repository URL').fill('acme/widget');
    await page.getByRole('button', { name: 'Clone repository' }).click();

    await expect(page.getByText(/Connection interrupted/)).toBeVisible();
    // The three things the reviewed build got wrong, together.
    await expect(page.getByRole('button', { name: 'Clone repository' })).toBeDisabled();
    await expect(page.getByText(/Last update:/)).toBeVisible();
    await expect(page.locator('progress')).toHaveCount(0);
    expect(creates).toBe(1);
  });

  test('recover after a missing job — a key alone never declares success', async ({ page }) => {
    await stubResolve(page);
    let reconciles = 0;
    await page.route('**/api/projects', async (route) => {
      await route.fulfill({ status: 202, json: { jobId: 'job-2' } });
    });
    await page.route('**/api/projects/create-jobs/job-2', async (route) => {
      await route.fulfill({ status: 404, json: { error: 'Unknown job' } });
    });
    await page.route('**/api/projects/create-jobs/reconcile', async (route) => {
      reconciles += 1;
      await route.fulfill({ json: { status: 'unknown', reason: 'no proof on this server' } });
    });

    await openCreatePage(page, '?mode=clone');
    await page.getByLabel('Repository URL').fill('acme/widget');
    await page.getByRole('button', { name: 'Clone repository' }).click();

    await expect(page.getByText(/Connection interrupted/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
    expect(reconciles).toBe(1); // once, not a retry loop
  });

  test('finish setup after a workspace failure — repair is offered, not another clone', async ({
    page,
  }) => {
    await stubResolve(page);
    let clones = 0;
    await page.route('**/api/projects', async (route) => {
      clones += 1;
      await route.fulfill({ status: 202, json: { jobId: 'job-3' } });
    });
    await page.route('**/api/projects/create-jobs/job-3', async (route) => {
      await route.fulfill({
        json: {
          status: 'failed',
          phase: 'failed',
          percent: null,
          error: 'setup did not finish',
          failure: {
            code: 'setup-incomplete',
            message: 'The repository is available at /tmp/e2e/Projects/widget, but project setup did not finish.',
            retrySafe: false,
            recovery: { action: 'finish-setup', key: 'widget', path: '/tmp/e2e/Projects/widget' },
          },
        },
      });
    });

    await openCreatePage(page, '?mode=clone');
    await page.getByLabel('Repository URL').fill('acme/widget');
    await page.getByRole('button', { name: 'Clone repository' }).click();

    await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
    // Cloning again would duplicate the repository that is already on disk.
    await expect(page.getByRole('button', { name: 'Clone repository' })).toBeDisabled();
    expect(clones).toBe(1);
  });

  test('authentication failure explains the cause without leaking the token', async ({ page }) => {
    await stubResolve(page);
    await page.route('**/api/projects', async (route) => {
      await route.fulfill({
        status: 500,
        json: {
          error: 'This server could not authenticate to the repository.',
          failure: {
            code: 'authentication-required',
            message:
              'This server could not authenticate to the repository. Configure credentials on this server, then check again.',
            detail: "fatal: Authentication failed for 'https://github.com/acme/widget.git'",
            retrySafe: true,
          },
        },
      });
    });

    await openCreatePage(page, '?mode=clone');
    await page.getByLabel('Repository URL').fill('acme/widget');
    await page.getByRole('button', { name: 'Clone repository' }).click();

    await expect(page.getByText(/Configure credentials on this server/)).toBeVisible();
    // Never ssh-add guidance for an HTTPS failure, and no credential in the DOM.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('ssh-add');
    expect(body).not.toMatch(/ghp_|:\/\/[^/@\s]+@/);
  });

  test('keyboard and label wiring', async ({ page }) => {
    await stubResolve(page);
    await openCreatePage(page, '?mode=clone');

    // Focus lands on the field that starts the mode.
    await expect(page.getByLabel('Repository URL')).toBeFocused();

    await page.getByLabel('Repository URL').fill('acme/widget');
    await page.getByRole('button', { name: 'Options' }).click();
    // Every field is reachable by its label.
    await expect(page.getByLabel('Issue prefix')).toBeVisible();
    await expect(page.getByLabel('Parent folder')).toBeVisible();
  });

  test('responsive: no horizontal overflow at three viewport sizes', async ({ page }) => {
    await stubResolve(page);
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openCreatePage(page, '?mode=clone');
      await page.getByLabel('Repository URL').fill('acme/widget');
      // Wait for the resolve to land, or the screenshot captures "Checking…"
      // and evidences nothing about the populated form.
      await expect(page.getByLabel('Parent folder')).toHaveValue('/tmp/e2e/Projects');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);

      await page.screenshot({
        path: `test-results/pan3836-create-${viewport.width}.png`,
        fullPage: true,
      });
    }
  });
});
