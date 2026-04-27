import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:3013';
const ISSUE_ID = 'PAN-865';

const PROJECTS_RESPONSE = [
  {
    name: 'pan',
    path: '/tmp/pan',
    features: [
      {
        issueId: ISSUE_ID,
        title: 'Zone C overview',
        branch: 'feature/pan-865',
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

const ISSUES_RESPONSE = {
  issues: [
    {
      identifier: ISSUE_ID,
      title: 'Tab-strip skeleton + Overview tab',
      status: 'in_progress',
      source: 'github',
      url: `https://example.test/issues/${ISSUE_ID}`,
    },
  ],
};

const AGENTS_RESPONSE = [
  {
    id: 'agent-pan-865',
    issueId: ISSUE_ID,
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  },
];

const PLANNING_RESPONSE = {
  prd: '# PRD',
  state: '# STATE',
  inference: '',
};

const ACTIVITY_RESPONSE = {
  issueId: ISSUE_ID,
  totalCost: 4.32,
  sections: Array.from({ length: 12 }, (_, index) => ({
    type: index < 3 ? 'review' : 'work',
    sessionId: `session-${index}`,
    model: `model-${index}`,
    startedAt: new Date(Date.now() - index * 60_000).toISOString(),
    duration: null,
    status: index === 0 ? 'failed' : 'running',
    role: index < 3 ? 'review' : 'work',
  })),
};

const COSTS_RESPONSE = {
  issueId: ISSUE_ID,
  totalCost: 4.32,
  totalTokens: 42000,
  sessions: [],
  byModel: {
    'claude-sonnet-4-6': { cost: 4.32, tokens: 42000 },
  },
  byStage: {
    planning: { cost: 0.5, tokens: 3000 },
    work: { cost: 3.82, tokens: 39000 },
  },
};

const REVIEW_STATUS_RESPONSE = {
  issueId: ISSUE_ID,
  reviewStatus: 'failed',
  testStatus: 'failed',
  mergeStatus: 'failed',
  verificationStatus: 'failed',
  readyForMerge: false,
  updatedAt: new Date().toISOString(),
};

const WORKSPACE_RESPONSE = {
  exists: true,
  issueId: ISSUE_ID,
  path: `/tmp/${ISSUE_ID.toLowerCase()}`,
  frontendUrl: 'http://localhost:4173',
  apiUrl: 'http://localhost:3011',
  hasAgent: true,
  agentSessionId: 'agent-pan-865',
  agentModel: 'claude-sonnet-4-6',
  agentModelFull: 'claude-sonnet-4-6',
  services: [
    { name: 'Frontend', url: 'http://localhost:4173' },
    { name: 'API', url: 'http://localhost:3011' },
  ],
  containers: [
    { name: 'frontend', status: 'running' },
  ],
  hasDocker: true,
  canContainerize: true,
  location: 'local',
};

const PR_RESPONSE = {
  issueId: ISSUE_ID,
  pr: null,
  diff: null,
};

const DISCUSSIONS_RESPONSE = {
  issueId: ISSUE_ID,
  items: [],
  prNumber: null,
};

test.describe('PAN-865 command deck overview', () => {
  test('renders the overview surface for visual verification', async ({ page }) => {
    await page.route('**/api/command-deck/projects', route => route.fulfill({ json: PROJECTS_RESPONSE }));
    await page.route('**/api/session-trees?projects=*', route => route.fulfill({ json: SESSION_TREES_RESPONSE }));
    await page.route('**/api/issues', route => route.fulfill({ json: ISSUES_RESPONSE }));
    await page.route('**/api/agents', route => route.fulfill({ json: AGENTS_RESPONSE }));
    await page.route('**/api/conversations', route => route.fulfill({ json: [] }));
    await page.route('**/api/costs/by-issue', route => route.fulfill({ json: { issues: [{ issueId: ISSUE_ID, totalCost: 4.32 }] } }));
    await page.route('**/api/version', route => route.fulfill({ json: { version: 'test' } }));
    await page.route('**/api/command-deck/planning/*', route => route.fulfill({ json: PLANNING_RESPONSE }));
    await page.route('**/api/command-deck/activity/*', route => route.fulfill({ json: ACTIVITY_RESPONSE }));
    await page.route('**/api/issues/*/costs', route => route.fulfill({ json: COSTS_RESPONSE }));
    await page.route('**/api/review/*/status', route => route.fulfill({ json: REVIEW_STATUS_RESPONSE }));
    await page.route('**/api/workspaces/*', route => route.fulfill({ json: WORKSPACE_RESPONSE }));
    await page.route('**/api/issues/*/pr', route => route.fulfill({ json: PR_RESPONSE }));
    await page.route('**/api/issues/*/discussions', route => route.fulfill({ json: DISCUSSIONS_RESPONSE }));
    await page.route('**/api/cloister/**', route => route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } }));

    await page.goto(`${BASE_URL}/command-deck`);
    await page.getByRole('button', { name: new RegExp(ISSUE_ID) }).click();

    await expect(page.getByTestId('zone-c-overview')).toBeVisible();
    await expect(page.getByTestId('overview-billboard')).toBeVisible();
    await expect(page.getByTestId('overview-tile-grid')).toBeVisible();
    await expect(page.getByTestId('overview-sparkline')).toBeVisible();
    await expect(page.getByTestId('zone-c-overview-tab-inference')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(10);
    await expect(page.getByTestId('overview-action-recover')).toBeVisible();
    await expect(page.locator('[data-testid="overview-activity-list"] li')).toHaveCount(10);

    await expect(page.getByTestId('zone-c-overview')).toHaveScreenshot('pan-865-overview.png');
  });
});
