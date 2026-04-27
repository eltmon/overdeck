import { expect, test } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://127.0.0.1:3011';

const RESOURCE_ISSUES = [
  {
    issueId: 'PAN-862',
    title: 'Resource strip visual test',
    projectName: 'panopticon-cli',
    branch: 'feature/pan-862',
    status: 'running',
    stateLabel: 'In Progress',
    agentStatus: 'active',
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    readyForMerge: false,
    resourceSources: ['workspace', 'branch', 'tmux', 'vbrief', 'beads', 'pr', 'docker'],
    resourceDetails: {
      hasWorkspace: true,
      workspacePaths: ['/tmp/workspaces/feature-pan-862'],
      localBranchCount: 1,
      localBranchNames: ['feature/pan-862'],
      remoteBranchCount: 1,
      remoteBranchNames: ['origin/feature/pan-862'],
      tmuxSessionCount: 2,
      tmuxSessionNames: ['agent-pan-862', 'review-pan-862'],
      prs: [
        {
          number: 862,
          title: 'PAN-862 main PR',
          url: 'https://example.test/pr/862',
          state: 'OPEN',
          isDraft: false,
        },
        {
          number: 863,
          title: 'PAN-862 draft PR',
          url: 'https://example.test/pr/863',
          state: 'OPEN',
          isDraft: true,
        },
      ],
      hasVbrief: true,
      hasBeads: true,
      dockerContainerCount: 1,
      dockerContainerNames: ['pan-862-db'],
    },
  },
  {
    issueId: 'PAN-777',
    title: 'Closed but still allocated',
    projectName: 'panopticon-cli',
    branch: 'feature/pan-777',
    status: 'idle',
    stateLabel: 'Closed',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    readyForMerge: false,
    rawTrackerState: 'closed',
    resourceSources: ['workspace', 'branch'],
    resourceDetails: {
      hasWorkspace: true,
      workspacePaths: ['/tmp/workspaces/feature-pan-777'],
      localBranchCount: 1,
      localBranchNames: ['feature/pan-777'],
      remoteBranchCount: 0,
      remoteBranchNames: [],
      tmuxSessionCount: 0,
      tmuxSessionNames: [],
      prs: [],
      hasVbrief: false,
      hasBeads: false,
      dockerContainerCount: 0,
      dockerContainerNames: [],
    },
  },
];

test.describe('Command Deck resource strip', () => {
  test('renders sanitized resource icons and hover details for resource-allocated issues', async ({ page }) => {
    await page.route('**/api/issues/resource-allocated', (route) => {
      route.fulfill({ json: RESOURCE_ISSUES });
    });
    await page.route('**/api/session-trees?**', (route) => {
      route.fulfill({ json: { trees: [] } });
    });
    await page.route('**/api/conversations', (route) => {
      route.fulfill({ json: [] });
    });
    await page.route('**/api/costs/by-issue', (route) => {
      route.fulfill({ json: { issues: [] } });
    });
    await page.route('**/api/version', (route) => {
      route.fulfill({ json: { version: 'test' } });
    });
    await page.route('**/api/issues', (route) => {
      route.fulfill({ json: { issues: [] } });
    });

    await page.goto(DASHBOARD_URL);
    await page.goto(`${DASHBOARD_URL}/command-deck`);

    const projectHeader = page.getByRole('button', { name: /panopticon-cli/ }).first();
    if (await projectHeader.count()) {
      await projectHeader.click().catch(() => {});
      await projectHeader.click().catch(() => {});
    }

    const pan862Row = page.locator('button').filter({ hasText: 'PAN-862' }).first();
    const pan777Row = page.locator('button').filter({ hasText: 'PAN-777' }).first();
    await expect(pan862Row).toBeVisible();
    await expect(pan777Row).toBeVisible();
    await expect(pan777Row.locator('[class*="featureState"]').getByText('Closed', { exact: true })).toBeVisible();

    const workspaceIcon = pan862Row.getByTitle('workspace: allocated');
    await expect(workspaceIcon).toBeVisible();
    await expect(pan862Row.getByTitle('branch: local 1 · remote 1')).toBeVisible();
    await expect(pan862Row.getByTitle('tmux: 2 sessions')).toBeVisible();
    await expect(pan862Row.getByTitle('vBRIEF: present')).toBeVisible();
    await expect(pan862Row.getByTitle('beads: present')).toBeVisible();
    await expect(pan862Row.getByTitle('PR: 2 open')).toBeVisible();
    await expect(pan862Row.getByTitle('docker: 1 container')).toBeVisible();
    await workspaceIcon.hover();

    await expect(pan862Row.getByText('workspace allocated', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('branches: 1 local · 1 remote', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('tmux: 2 active sessions', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('vBRIEF present', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('beads present', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('PR: #862 PAN-862 main PR', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('PR: #863 PAN-862 draft PR', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('docker: 1 running container', { exact: true })).toBeVisible();

    const closedWorkspaceIcon = pan777Row.getByTitle('workspace: allocated');
    await closedWorkspaceIcon.hover();
    await expect(pan777Row.getByRole('button', { name: 'Cleanup' }).first()).toBeVisible();
  });
});
