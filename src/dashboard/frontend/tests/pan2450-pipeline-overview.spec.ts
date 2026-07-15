import { expect, test } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3012';

const MOCK_ISSUES = [
  {
    issueId: 'MIN-857',
    title: 'Voice UX overhaul',
    projectName: 'mind-your-now',
    branch: 'feature/min-857',
    status: 'running',
    stateLabel: 'In Review',
    agentStatus: 'active',
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    isRally: false,
    readyForMerge: true,
    resourceSources: ['beads', 'docker', 'tmux', 'tracker', 'vbrief', 'workspace'],
    resourceDetails: {
      hasWorkspace: true,
      localBranchCount: 0,
      remoteBranchCount: 0,
      tmuxSessionCount: 3,
      prs: [],
      hasVbrief: true,
      hasTasks: true,
      dockerContainerCount: 4,
    },
  },
  {
    issueId: 'MIN-860',
    title: 'Mobile push notifications broken end-to-end',
    projectName: 'mind-your-now',
    branch: 'feature/min-860',
    status: 'running',
    stateLabel: 'In Progress',
    agentStatus: 'active',
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    isRally: false,
    readyForMerge: false,
    resourceSources: ['beads', 'docker', 'tmux', 'tracker', 'vbrief', 'workspace'],
    resourceDetails: {
      hasWorkspace: true,
      localBranchCount: 1,
      remoteBranchCount: 1,
      tmuxSessionCount: 2,
      prs: [{ number: 860, title: 'MIN-860 PR', state: 'OPEN', isDraft: false }],
      hasVbrief: true,
      hasTasks: true,
      dockerContainerCount: 2,
    },
  },
  {
    issueId: 'MIN-861',
    title: 'Plan approval pending issue',
    projectName: 'mind-your-now',
    branch: 'feature/min-861',
    status: 'open',
    stateLabel: 'Todo',
    agentStatus: null,
    hasPlanning: true,
    hasPrd: true,
    hasState: false,
    isShadow: false,
    isRally: false,
    readyForMerge: false,
    resourceSources: ['vbrief'],
    resourceDetails: {
      hasWorkspace: false,
      localBranchCount: 0,
      remoteBranchCount: 0,
      tmuxSessionCount: 0,
      prs: [],
      hasVbrief: true,
      hasTasks: false,
      dockerContainerCount: 0,
    },
  },
];

async function mockApi(page) {
  await page.route('**/api/issues/resource-allocated', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ISSUES) });
  });
  await page.route('**/api/registered-projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'mind-your-now', name: 'mind-your-now', path: '/tmp/myn' }]) });
  });
  await page.route('**/api/session-trees**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trees: [] }) });
  });
  await page.route('**/api/conversations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/costs/by-issue', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ issues: [] }) });
  });
  await page.route('**/api/costs/summary**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ week: { totalCost: 12.34 } }) });
  });
  await page.route('**/api/version', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'test' }) });
  });
  await page.route('**/api/flywheel/uat-generations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test.describe('PAN-2450 pipeline overview', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function screenshotPipeline(page, theme: 'light' | 'dark', output: string) {
    await mockApi(page);
    await page.goto(`${DASHBOARD_URL}/command-deck`);
    await page.evaluate((t) => {
      localStorage.setItem('overdeck.ui.theme', t);
    }, theme);
    await page.reload();

    const sidebarProject = page.locator('[data-testid^="sidebar-project-"]').filter({ hasText: 'mind-your-now' }).first();
    await expect(sidebarProject).toBeVisible({ timeout: 20_000 });
    // Dismiss any recovery/overlay that intercepts pointer events in the test environment.
    await page.locator('#pan-recovery-overlay').evaluate((el) => el.remove()).catch(() => {});
    await sidebarProject.click();

    const pipelineSection = page.getByTestId('pipeline-section');
    await expect(pipelineSection).toBeVisible({ timeout: 20_000 });
    await expect(pipelineSection.locator('[data-testid="pipeline-row"]').first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: output, fullPage: true });
  }

  test('light theme pipeline overview', async ({ page }) => {
    await screenshotPipeline(page, 'light', 'test-results/pan2450-pipeline-light.png');
  });

  test('dark theme pipeline overview', async ({ page }) => {
    await screenshotPipeline(page, 'dark', 'test-results/pan2450-pipeline-dark.png');
  });
});
