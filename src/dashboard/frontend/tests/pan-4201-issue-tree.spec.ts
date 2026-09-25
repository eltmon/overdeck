import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3450';

interface MockSession {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  presence: string;
}

interface MockIssue {
  issueId: string;
  title: string;
  projectName: string;
  branch: string;
  status: string;
  stateLabel: string;
  state: string | null;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  pipelineBucket?: string;
  sessions?: MockSession[];
  resourceSources: string[];
  resourceDetails: {
    hasWorkspace: boolean;
    localBranchCount: number;
    remoteBranchCount: number;
    tmuxSessionCount: number;
    prs: Array<{ number: number; title: string; state: string; isDraft: boolean }>;
    hasXbrief: boolean;
    hasTasks: boolean;
    hasPrd: boolean;
    dockerContainerCount: number;
  };
}

// PAN-99001..99007 cannot exist in the live read model, so unmocked /ws/rpc
// traffic (which proxies to the operator's real dashboard on :3011) never
// carries a store-derived state for these ids — the REST `state` field below
// is what resolveFeatureStateBadge falls back to.
const BASE_RESOURCE_DETAILS = {
  hasWorkspace: true,
  localBranchCount: 1,
  remoteBranchCount: 0,
  tmuxSessionCount: 0,
  prs: [],
  hasXbrief: false,
  hasTasks: false,
  hasPrd: false,
  dockerContainerCount: 0,
};

function makeIssue(overrides: Partial<MockIssue> & Pick<MockIssue, 'issueId' | 'title'>): MockIssue {
  return {
    issueId: overrides.issueId,
    title: overrides.title,
    projectName: 'overdeck',
    branch: `feature/${overrides.issueId.toLowerCase()}`,
    status: 'idle',
    stateLabel: 'Allocated',
    state: null,
    agentStatus: null,
    hasPlanning: true,
    hasPrd: false,
    hasState: true,
    isShadow: false,
    resourceSources: ['workspace', 'branch'],
    resourceDetails: { ...BASE_RESOURCE_DETAILS },
    ...overrides,
  };
}

const MOCK_ISSUES: MockIssue[] = [
  makeIssue({
    issueId: 'PAN-99001',
    title: 'Planned with an active planning session',
    state: 'planned',
    sessions: [
      { type: 'planning', sessionId: 'pan-99001-plan', model: 'claude-sonnet-5', startedAt: '2026-09-25T00:00:00Z', duration: 120, status: 'running', presence: 'active' },
    ],
  }),
  makeIssue({
    issueId: 'PAN-99002',
    title: 'Working with an active work session',
    state: 'working',
    sessions: [
      { type: 'work', sessionId: 'pan-99002-work', model: 'claude-sonnet-5', startedAt: '2026-09-25T00:00:00Z', duration: 300, status: 'running', presence: 'active' },
    ],
  }),
  makeIssue({ issueId: 'PAN-99003', title: 'Pull request in review', state: 'in-review' }),
  makeIssue({ issueId: 'PAN-99004', title: 'Review asked for changes', state: 'changes-requested' }),
  makeIssue({ issueId: 'PAN-99005', title: 'Approved and mergeable', state: 'ready' }),
  makeIssue({ issueId: 'PAN-99006', title: 'Merged, close-out pending', state: null, pipelineBucket: 'post_merge_limbo' }),
  makeIssue({ issueId: 'PAN-99007', title: 'Open issue with no plan yet', state: 'backlog' }),
];

const EXPECTED_STATE_LABEL: Record<string, string> = {
  'PAN-99001': 'Planning',
  'PAN-99002': 'Working',
  'PAN-99003': 'In review',
  'PAN-99004': 'Changes requested',
  'PAN-99005': 'Ready',
  'PAN-99006': 'Merged',
  'PAN-99007': 'Backlog',
};

async function mockApi(page: Page) {
  await page.route('**/api/issues/resource-allocated', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ISSUES) });
  });
  await page.route('**/api/registered-projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'overdeck', name: 'overdeck', path: '/tmp/overdeck' }]) });
  });
  await page.route('**/api/pipeline/membership**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/issues/*/resource-details', async (route) => {
    const url = new URL(route.request().url());
    const issueId = url.pathname.split('/').at(-2)?.toUpperCase();
    const issue = MOCK_ISSUES.find((i) => i.issueId === issueId);
    const payload = issue
      ? {
          workspacePaths: [`/tmp/workspaces/feature-${issue.issueId.toLowerCase()}`],
          localBranchNames: [issue.branch],
          remoteBranchNames: [],
          tmuxSessionNames: [],
          prs: [],
          dockerContainerNames: [],
        }
      : null;
    await route.fulfill({ status: payload ? 200 : 404, contentType: 'application/json', body: JSON.stringify(payload ?? { error: 'Not found' }) });
  });
  await page.route('**/api/session-trees**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trees: [] }) });
  });
  await page.route('**/api/conversations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/costs/by-issue**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ issues: [] }) });
  });
  await page.route('**/api/version**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'test' }) });
  });
  await page.route('**/api/merge-train/generations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/merge-train/queues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/boot-reconciliation', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ decision: null, perAgent: {}, decidedAt: null, bootId: null, graceDeadline: null, set: [] }),
    });
  });
}

async function selectSidebarProject(page: Page, projectName: string) {
  const sidebarProject = page.getByTestId(`sidebar-project-${projectName}`);
  await expect(sidebarProject).toBeVisible({ timeout: 20_000 });
  await page.locator('#pan-recovery-overlay').evaluate((el) => el.remove()).catch(() => {});
  await sidebarProject.dispatchEvent('click');
}

async function gotoIssueTree(page: Page, theme: 'light' | 'dark') {
  await mockApi(page);
  await page.goto(`${DASHBOARD_URL}/command-deck`);
  await page.evaluate((t) => localStorage.setItem('overdeck.ui.theme', t), theme);
  await page.reload();
  await selectSidebarProject(page, 'overdeck');
  await expect(page.locator('[data-component="feature-item"][data-issue-id="PAN-99001"]')).toBeVisible({ timeout: 20_000 });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`PAN-4201 issue tree (${theme})`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test(`renders real state badges, no Allocated text, one live dot (${theme})`, async ({ page }) => {
      await gotoIssueTree(page, theme);

      await expect(page.getByText('Allocated')).toHaveCount(0);
      for (const [issueId, label] of Object.entries(EXPECTED_STATE_LABEL)) {
        const row = page.locator(`[data-component="feature-item"][data-issue-id="${issueId}"]`);
        await expect(row.locator('[data-testid="feature-state"]')).toHaveText(label);
      }

      const workingRow = page.locator('[data-component="feature-item"][data-issue-id="PAN-99002"]');
      await expect(workingRow.locator('[data-testid="status-dot"]')).toHaveCount(1);
      await expect(workingRow.locator('[data-testid="status-dot"]')).toHaveAttribute('data-status', 'active');

      await expect(page.getByText('branch local 1')).toHaveCount(0);

      await page.screenshot({ path: `docs/screenshots/pan-4201/${theme}-collapsed.png`, fullPage: true });
    });

    test(`expanded working row and live-agent clip (${theme})`, async ({ page }) => {
      await gotoIssueTree(page, theme);

      const workingRow = page.locator('[data-component="feature-item"][data-issue-id="PAN-99002"]');
      await workingRow.getByRole('button', { name: 'Expand sessions' }).click();
      await expect(workingRow.locator('[class*="sessionList"]')).toBeVisible();

      await page.screenshot({ path: `docs/screenshots/pan-4201/${theme}-expanded.png`, fullPage: true });
      await workingRow.screenshot({ path: `docs/screenshots/pan-4201/${theme}-live-agent.png` });
    });
  });
}
