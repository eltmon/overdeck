import { expect, test } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3010';

interface ResourceIssue {
  issueId: string;
  title: string;
  projectName: string;
  branch: string;
  status: string;
  stateLabel: string;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  readyForMerge: boolean;
  rawTrackerState?: string;
  resourceSources: string[];
  resourceDetails: {
    hasWorkspace: boolean;
    localBranchCount: number;
    remoteBranchCount: number;
    tmuxSessionCount: number;
    prs: Array<{
      number: number;
      title: string;
      state: string;
      isDraft: boolean;
    }>;
    hasVbrief: boolean;
    hasBeads: boolean;
    dockerContainerCount: number;
  };
}

interface ResourceDetailIdentifiers {
  workspacePaths: string[];
  localBranchNames: string[];
  remoteBranchNames: string[];
  tmuxSessionNames: string[];
  prs: Array<{
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }>;
  dockerContainerNames: string[];
}

const RESOURCE_ISSUES: ResourceIssue[] = [
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
      localBranchCount: 1,
      remoteBranchCount: 1,
      tmuxSessionCount: 2,
      prs: [
        {
          number: 862,
          title: 'PAN-862 main PR',
          state: 'OPEN',
          isDraft: false,
        },
        {
          number: 863,
          title: 'PAN-862 draft PR',
          state: 'OPEN',
          isDraft: true,
        },
      ],
      hasVbrief: true,
      hasBeads: true,
      dockerContainerCount: 1,
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
      localBranchCount: 1,
      remoteBranchCount: 0,
      tmuxSessionCount: 0,
      prs: [],
      hasVbrief: false,
      hasBeads: false,
      dockerContainerCount: 0,
    },
  },
];

const RESOURCE_DETAIL_IDENTIFIERS: Record<string, ResourceDetailIdentifiers> = {
  'PAN-862': {
    workspacePaths: ['/tmp/workspaces/feature-pan-862'],
    localBranchNames: ['feature/pan-862'],
    remoteBranchNames: ['origin/feature/pan-862'],
    tmuxSessionNames: ['agent-pan-862', 'review-pan-862'],
    prs: [
      {
        number: 862,
        title: 'PAN-862 main PR',
        state: 'OPEN',
        isDraft: false,
      },
      {
        number: 863,
        title: 'PAN-862 draft PR',
        state: 'OPEN',
        isDraft: true,
      },
    ],
    dockerContainerNames: ['pan-862-db'],
  },
  'PAN-777': {
    workspacePaths: ['/tmp/workspaces/feature-pan-777'],
    localBranchNames: ['feature/pan-777'],
    remoteBranchNames: [],
    tmuxSessionNames: [],
    prs: [],
    dockerContainerNames: [],
  },
};

test.describe('Command Deck resource strip', () => {
  test('renders concrete resource icons and hover details for resource-allocated issues', async ({ page }) => {
    await page.route('**/api/issues/resource-allocated', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(RESOURCE_ISSUES),
      });
    });
    await page.route('**/api/registered-projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ key: 'panopticon-cli', name: 'panopticon-cli', path: '/tmp/panopticon-cli' }]),
      });
    });
    await page.route('**/api/issues/*/resource-details', async (route) => {
      const url = new URL(route.request().url());
      const issueId = url.pathname.split('/').at(-2)?.toUpperCase();
      const payload = issueId ? RESOURCE_DETAIL_IDENTIFIERS[issueId] : null;
      await route.fulfill({
        status: payload ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(payload ?? { error: 'Not found' }),
      });
    });
    await page.route('**/api/session-trees**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ trees: [] }),
      });
    });
    await page.route('**/api/conversations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
    await page.route('**/api/costs/by-issue**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ issues: [] }),
      });
    });
    await page.route('**/api/version**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 'test' }),
      });
    });
    await page.route('**/api/flywheel/uat-generations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto(`${DASHBOARD_URL}/command-deck`);

    // Select the project from the sidebar rail. This sets selectedProject, which
    // mounts the ProjectNode (already expanded) in the Issues section.
    // PAN-1609: wait for the sidebar entry to mount before clicking — under CI
    // load the initial app boot (WS connect + first snapshot) can take several
    // seconds, and a click that races the mount silently no-ops, leaving the
    // rows un-rendered and flaking the first toBeVisible below.
    const sidebarProject = page.getByTestId('sidebar-project-panopticon-cli');
    await expect(sidebarProject).toBeVisible({ timeout: 20_000 });
    await sidebarProject.click();

    const pan862Item = page.locator('[data-component="feature-item"][data-issue-id="PAN-862"]');
    const pan777Item = page.locator('[data-component="feature-item"][data-issue-id="PAN-777"]');
    const pan862Row = pan862Item.locator('[class*="featureItemRow"]').first();
    const pan777Row = pan777Item.locator('[class*="featureItemRow"]').first();
    // First assertion after project selection gates on the data load + render —
    // give it generous headroom (the remaining assertions render together once
    // the row is present and keep the default timeout).
    await expect(pan862Row).toBeVisible({ timeout: 20_000 });
    await expect(pan777Row).toBeVisible();
    await expect(pan777Row.locator('[class*="featureState"]').getByText('Closed', { exact: true })).toBeVisible();

    const expectResourceChip = async (title: string, label: string) => {
      const chip = pan862Item.getByTitle(title);
      await expect(chip).toBeVisible();
      await expect(chip.locator('svg')).toBeVisible();
      await expect(chip.getByText(label, { exact: true })).toBeVisible();
      return chip;
    };

    const workspaceIcon = await expectResourceChip('workspace: allocated', 'workspace');
    await expectResourceChip('branch: local 1 · remote 1', 'branch local 1 · remote 1');
    await expectResourceChip('tmux: 2 sessions', 'tmux');
    await expectResourceChip('vBRIEF: present', 'vBRIEF');
    await expectResourceChip('beads: present', 'beads');
    await expectResourceChip('PR: #862 (open) · #863 (open, draft)', '#862');
    await expectResourceChip('docker: 1 container', 'stack 1');
    await workspaceIcon.hover();

    await expect(pan862Item.getByText('workspace: /tmp/workspaces/feature-pan-862', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('branch (local): feature/pan-862', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('branch (remote): origin/feature/pan-862', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('tmux: agent-pan-862', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('tmux: review-pan-862', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('vBRIEF present', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('beads present', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('PR: #862 PAN-862 main PR (open)', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('PR: #863 PAN-862 draft PR (open, draft)', { exact: true })).toBeVisible();
    await expect(pan862Item.getByText('docker: pan-862-db', { exact: true })).toBeVisible();

    const closedWorkspaceIcon = pan777Item.getByTitle('workspace: allocated');
    await expect(closedWorkspaceIcon.locator('svg')).toBeVisible();
    await expect(closedWorkspaceIcon.getByText('workspace', { exact: true })).toBeVisible();
    await closedWorkspaceIcon.hover();
    await expect(pan777Item.getByRole('button', { name: 'Cleanup' }).first()).toBeVisible();
  });
});
