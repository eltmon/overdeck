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

interface ProjectData {
  name: string;
  path: string;
  features: ResourceIssue[];
}

function groupProjects(issues: ResourceIssue[]): ProjectData[] {
  const grouped = new Map<string, ProjectData>();

  for (const issue of issues) {
    const existing = grouped.get(issue.projectName);
    if (existing) {
      existing.features.push(issue);
      continue;
    }

    grouped.set(issue.projectName, {
      name: issue.projectName,
      path: issue.projectName,
      features: [issue],
    });
  }

  return [...grouped.values()]
    .map((project) => ({
      ...project,
      features: [...project.features].sort((a, b) => a.issueId.localeCompare(b.issueId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    await page.route('**/api/command-deck/projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(groupProjects(RESOURCE_ISSUES)),
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

    await page.goto(`${DASHBOARD_URL}/command-deck`);

    const projectHeader = page.getByRole('button', { name: /panopticon-cli/ }).first();
    if (await projectHeader.count()) {
      await projectHeader.click().catch(() => {});
      await projectHeader.click().catch(() => {});
    }

    const pan862Row = page.locator('[class*="featureItemRow"]').filter({ hasText: 'PAN-862' }).first();
    const pan777Row = page.locator('[class*="featureItemRow"]').filter({ hasText: 'PAN-777' }).first();
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

    await expect(pan862Row.getByText('workspace: /tmp/workspaces/feature-pan-862', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('branch (local): feature/pan-862', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('branch (remote): origin/feature/pan-862', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('tmux: agent-pan-862', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('tmux: review-pan-862', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('vBRIEF present', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('beads present', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('PR: #862 PAN-862 main PR', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('PR: #863 PAN-862 draft PR', { exact: true })).toBeVisible();
    await expect(pan862Row.getByText('docker: pan-862-db', { exact: true })).toBeVisible();

    const closedWorkspaceIcon = pan777Row.getByTitle('workspace: allocated');
    await closedWorkspaceIcon.hover();
    await expect(pan777Row.getByRole('button', { name: 'Cleanup' }).first()).toBeVisible();
  });
});
