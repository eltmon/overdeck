import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:3013';
const ISSUE_ID = 'PAN-1230';

const PROJECTS_RESPONSE = [
  {
    name: 'pan',
    path: '/tmp/pan',
    features: [
      {
        issueId: ISSUE_ID,
        title: 'Command Deck lens',
        branch: 'feature/pan-1230',
        status: 'running',
        stateLabel: 'In Progress',
        agentStatus: 'running',
        hasPlanning: true,
        hasPrd: true,
        hasState: true,
        isShadow: false,
        readyForMerge: false,
        sessions: [],
      },
    ],
  },
];

const SESSION_TREES_RESPONSE = {
  trees: [
    {
      projectKey: 'pan',
      features: [
        {
          issueId: ISSUE_ID,
          sessions: [],
        },
      ],
    },
  ],
};

const REGISTERED_PROJECTS_RESPONSE = [
  { key: 'pan', name: 'pan', path: '/tmp/pan' },
];

const CONVERSATIONS_RESPONSE = [
  {
    id: 1,
    name: 'test-conv',
    tmuxSession: 'test-conv',
    status: 'active',
    cwd: '/tmp/pan',
    issueId: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    lastAttachedAt: new Date().toISOString(),
    sessionAlive: true,
    title: 'Test Conversation',
  },
];

const ISSUES_RESPONSE = {
  issues: [
    {
      identifier: ISSUE_ID,
      title: 'Command Deck lens',
      status: 'in_progress',
      source: 'github',
      url: `https://example.test/issues/${ISSUE_ID}`,
    },
  ],
};

const COSTS_RESPONSE = {
  issues: [{ issueId: ISSUE_ID, totalCost: 1.23 }],
};

test.describe('PAN-1230 command deck lens', () => {
  test('right pane lens defaults to pipeline on project select, persists issue context on feature select, switches to conversations on conversation select, and tab strip is 48px tall', async ({ page }) => {
    await page.route('**/api/command-deck/projects', route => route.fulfill({ json: PROJECTS_RESPONSE }));
    await page.route('**/api/session-trees?projects=*', route => route.fulfill({ json: SESSION_TREES_RESPONSE }));
    await page.route('**/api/registered-projects', route => route.fulfill({ json: REGISTERED_PROJECTS_RESPONSE }));
    await page.route('**/api/conversations', route => route.fulfill({ json: CONVERSATIONS_RESPONSE }));
    await page.route('**/api/conversations/*/messages', route => route.fulfill({ json: { messages: [], workLog: [], streaming: false } }));
    await page.route('**/api/conversations/*/diffs', route => route.fulfill({ json: { summaries: [] } }));
    await page.route('**/api/costs/by-issue', route => route.fulfill({ json: COSTS_RESPONSE }));
    await page.route('**/api/version', route => route.fulfill({ json: { version: 'test' } }));
    await page.route('**/api/issues', route => route.fulfill({ json: ISSUES_RESPONSE }));
    await page.route('**/api/agents', route => route.fulfill({ json: [] }));
    await page.route('**/api/command-deck/planning/*', route => route.fulfill({ json: { prd: '', state: '', inference: '' } }));
    await page.route('**/api/command-deck/activity/*', route => route.fulfill({ json: { issueId: ISSUE_ID, totalCost: 0, sections: [] } }));
    await page.route('**/api/issues/*/costs', route => route.fulfill({ json: { issueId: ISSUE_ID, totalCost: 0, totalTokens: 0, sessions: [], byModel: {}, byStage: {} } }));
    await page.route('**/api/review/*/status', route => route.fulfill({ json: { issueId: ISSUE_ID, reviewStatus: 'failed', testStatus: 'failed', mergeStatus: 'failed', verificationStatus: 'failed', readyForMerge: false, updatedAt: new Date().toISOString() } }));
    await page.route('**/api/workspaces/*', route => route.fulfill({ json: { exists: true, issueId: ISSUE_ID, path: '/tmp/pan-1230', frontendUrl: '', apiUrl: '', hasAgent: false, services: [], containers: [], hasDocker: false, canContainerize: false, location: 'local' } }));
    await page.route('**/api/issues/*/pr/details', route => route.fulfill({ json: { issueId: ISSUE_ID, pr: null } }));
    await page.route('**/api/issues/*/pr', route => route.fulfill({ json: { issueId: ISSUE_ID, pr: null } }));
    await page.route('**/api/issues/*/discussions', route => route.fulfill({ json: { issueId: ISSUE_ID, items: [], prNumber: null } }));
    await page.route('**/api/cloister/**', route => route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } }));
    await page.route('**/api/resources', route => route.fulfill({ json: { containers: [] } }));

    await page.goto(`${BASE_URL}/command-deck`);

    // Click project header to reveal lens in right pane
    const projectHeader = page.getByRole('button', { name: 'pan' });
    await expect(projectHeader).toBeVisible();
    await projectHeader.click();

    const rightPane = page.getByTestId('command-deck-right-pane-tabs');
    await expect(rightPane).toBeVisible();

    // Pipeline tab should be the default for a fresh project
    const pipelineTab = page.getByRole('tab', { name: 'Pipeline' });
    await expect(pipelineTab).toBeVisible();
    await expect(pipelineTab).toHaveAttribute('aria-selected', 'true');

    // Select feature — lens should persist with issue context in Pipeline tab
    const featureRow = page.locator('[class*="featureItemRow"]').filter({ hasText: ISSUE_ID }).first();
    await expect(featureRow).toBeVisible();
    await featureRow.click();

    await expect(pipelineTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('zone-a')).toBeVisible();

    // Select conversation under project — Conversations tab should open with inline panel
    const conversationButton = page.getByRole('button', { name: 'Test Conversation' });
    await expect(conversationButton).toBeVisible();
    await conversationButton.click();

    const conversationsTab = page.getByRole('tab', { name: 'Conversations' });
    await expect(conversationsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Back to conversations')).toBeVisible();

    // Tab strip height must be exactly 48px
    const tabStrip = rightPane.locator('[role="tablist"]');
    await expect(tabStrip).toBeVisible();
    const height = await tabStrip.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBe(48);
  });
});
