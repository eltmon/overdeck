/**
 * PAN-5293 AC-F checklist: every row of the parent no-loss table that child F
 * owns has a reachable home in the left column, and each home works.
 *
 * Run against a branch dashboard seeded with the workflow fixture
 * (docs/DASHBOARD-ARCHITECTURE.md "Workflow fixture"), in an isolated
 * browser profile:
 *
 *   DASHBOARD_URL=http://127.0.0.1:<port> npx playwright test tests/pan-5293-left-column.spec.ts
 *
 * Creating a conversation would launch a real agent, so that POST, the issue
 * list and the workspace registry are routed to fixed answers; everything
 * else reads the seeded fixture.
 */
import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://127.0.0.1:3013';
const PROJECT = 'workflow-fixture';
/** The fixture project's display name: switcher rows and deck URLs use it. */
const PROJECT_NAME = 'Workflow fixture';
const PROJECT_PATH = encodeURIComponent(PROJECT_NAME);

const ISSUE = {
  issueId: 'WFX-1',
  title: 'Fixture issue',
  projectName: PROJECT_NAME,
  branch: 'feature/wfx-1',
  status: 'running',
  stateLabel: 'Todo',
  agentStatus: null,
  hasPlanning: true,
  hasPrd: false,
  hasState: false,
  isShadow: false,
  resourceSources: ['workspace'],
  resourceDetails: {
    hasWorkspace: true,
    localBranchCount: 1,
    remoteBranchCount: 0,
    tmuxSessionCount: 0,
    prs: [],
    hasXbrief: false,
    hasTasks: false,
    dockerContainerCount: 0,
  },
};

async function routeFixedAnswers(page: Page) {
  await page.route('**/api/issues/resource-allocated', (route) => route.fulfill({ json: [ISSUE] }));
  await page.route('**/api/workspace-registry', (route) => route.fulfill({
    json: {
      workspaces: [{
        id: 'ws-fixture-scratch',
        projectId: PROJECT,
        kind: 'scratch',
        origin: 'operator',
        name: 'fixture-scratch',
        issueId: null,
        isFavorite: false,
        isArchived: false,
        title: null,
        lastAccessedAt: Date.now(),
      }],
    },
  }));
  await page.route('**/api/conversations', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ json: { id: 9001, name: 'pw-created', title: 'Agent' } });
  });
}

async function openDashboard(page: Page, path: string) {
  await routeFixedAnswers(page);
  await page.goto(`${DASHBOARD_URL}${path}`);
  await page.locator('#pan-recovery-overlay').evaluate((el) => el.remove()).catch(() => {});
  await expect(page.getByTestId('left-column')).toBeVisible({ timeout: 30_000 });
}

async function pickProject(page: Page) {
  await page.getByTestId('project-switcher').click();
  await page.getByTestId(`project-switcher-row-${PROJECT_NAME}`).click();
  await expect(page).toHaveURL(new RegExp(`/command-deck/${PROJECT_PATH}$`));
}

test.describe('PAN-5293 left column checklist', () => {
  test.use({ viewport: { width: 1920, height: 1000 } });

  test('every F-owned home is reachable from the left column', async ({ page }) => {
    await openDashboard(page, '/flywheel');

    await test.step('Projects tree → the project switcher picks a project', async () => {
      await expect(page.getByTestId('project-switcher')).toBeVisible();
      await pickProject(page);
      await expect(page.getByTestId('project-switcher')).toContainText(PROJECT_NAME);
    });

    await test.step('Home → the top-bar brand opens /', async () => {
      await page.getByTestId('topbar-brand').click();
      await expect(page).toHaveURL(`${DASHBOARD_URL}/`);
    });

    await test.step('Flywheel and Order Book → nav entries', async () => {
      await page.getByTestId('sidebar-flywheel').click();
      await expect(page).toHaveURL(/\/flywheel$/);
      await page.getByTestId('sidebar-orders').click();
      await expect(page).toHaveURL(/\/orders/);
    });

    await test.step('More groups → More ▾ opens Pipeline', async () => {
      await page.getByTestId('left-nav-more').click();
      await expect(page.getByTestId('left-nav-group-System')).toBeVisible();
      await page.getByTestId('sidebar-pipeline').click();
      await expect(page).toHaveURL(/\/pipeline/);
    });

    await test.step('Conversation list → a row opens its conversation in the deck', async () => {
      const row = page.getByTitle('fixture-1').first();
      await page.getByTestId('conversation-scope-all').click();
      await expect(row).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(/\/conv\//);
    });

    await test.step('Command Deck new conversation → New conversation creates and opens it', async () => {
      await page.getByTestId('sidebar-flywheel').click();
      await page.getByTestId('new-conversation-button').click();
      await expect(page).toHaveURL(/\/conv\/9001/);
    });

    await test.step('Pickers and Retrospective → the New conversation caret menu', async () => {
      await page.getByTestId('new-conversation-caret').click();
      await expect(page.getByTestId('new-conversation-menu')).toBeVisible();
      await expect(page.getByTestId('new-conversation-with-options')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    await test.step('Issues list → an issue row opens its cockpit', async () => {
      await page.getByTestId('sidebar-flywheel').click();
      await expect(page.getByTestId('left-issues')).toContainText('WFX-1');
      await page.getByTestId('left-issues').getByText('WFX-1').first().click();
      await expect(page).toHaveURL(new RegExp(`/command-deck/${PROJECT_PATH}/WFX-1`));
    });

    await test.step('Workspaces rail → a workspace row opens its view', async () => {
      await page.getByTestId('sidebar-workspace-ws-fixture-scratch').click();
      await expect(page).toHaveURL(/\/workspace\/ws-fixture-scratch/);
    });

    await test.step('New workspace → the switcher and the section header +', async () => {
      await page.getByTestId('sidebar-new-workspace').click();
      await expect(page).toHaveURL(new RegExp(`/workspaces/new\\?project=${PROJECT}`));
    });

    await test.step('Awareness → the Feed tab on /activity', async () => {
      await page.getByTestId('left-nav-more').click();
      await page.getByTestId('sidebar-activity').click();
      await expect(page).toHaveURL(/\/activity/);
      await expect(page.getByTestId('activity-feed-tab')).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Awareness scope' })).toBeVisible();
    });

    await test.step('Off-deck History toggle → gone from the top bar', async () => {
      await expect(page.getByRole('button', { name: /activity feed/i })).toHaveCount(0);
    });

    await test.step('Footer version → the updater', async () => {
      await page.getByTestId('left-column-version').click();
      await expect(page.getByRole('dialog').first()).toBeVisible();
      await page.keyboard.press('Escape');
    });

    await test.step('Lens hint → the ? shortcuts sheet', async () => {
      await page.getByTestId('left-column-shortcuts').click();
      await expect(page.getByRole('dialog', { name: /shortcut/i })).toBeVisible();
      await page.keyboard.press('Escape');
    });

    await test.step('Sidebar collapse [ → the column collapses to 48 px', async () => {
      await page.locator('body').click({ position: { x: 1200, y: 500 } });
      await page.keyboard.press('[');
      await expect(page.getByTestId('left-column')).toHaveAttribute('data-collapsed', 'true');
      const width = await page.getByTestId('left-column').evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBe(48);
      await page.keyboard.press('[');
      await expect(page.getByTestId('left-column')).not.toHaveAttribute('data-collapsed', 'true');
    });
  });

  test.describe('below 900 px', () => {
    test.use({ viewport: { width: 800, height: 900 } });

    test('the column is a drawer opened by Open navigation and closed by its overlay', async ({ page }) => {
      await routeFixedAnswers(page);
      await page.goto(`${DASHBOARD_URL}/flywheel`);
      await page.locator('#pan-recovery-overlay').evaluate((el) => el.remove()).catch(() => {});
      const column = page.getByTestId('left-column');
      const open = page.getByRole('button', { name: 'Open navigation' });
      await expect(open).toBeVisible({ timeout: 30_000 });
      await expect(column).toBeHidden();

      await open.click();
      await expect(column).toBeVisible();
      // The drawer overlays the page instead of pushing it.
      expect(await column.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
      await page.screenshot({ path: '../../../.tmp/pan-5293-screens/drawer-800-open.png' });

      await page.getByTestId('left-column-overlay').click({ position: { x: 780, y: 450 } });
      await expect(column).toBeHidden();
      await page.screenshot({ path: '../../../.tmp/pan-5293-screens/drawer-800-closed.png' });
    });
  });
});
