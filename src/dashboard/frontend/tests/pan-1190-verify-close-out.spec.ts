import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:3013';
const ISSUE_ID = 'PAN-1190';

const baseIssue = {
  id: ISSUE_ID,
  identifier: ISSUE_ID,
  title: 'Verify close-out flow',
  description: 'Merged work remains visible until explicit close-out.',
  priority: 2,
  labels: ['review ready'],
  url: `https://example.test/issues/${ISSUE_ID}`,
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  project: { id: 'panopticon', name: 'Panopticon', color: '#a855f7' },
  source: 'github',
};

async function installMockTransport(page: Page) {
  await page.addInitScript(() => {
    (window as typeof window & { __pan1190Stage?: 'ready' | 'verifying' | 'closed-out' }).__pan1190Stage = 'ready';
  });

  await page.route('**/src/lib/wsTransport.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
const ISSUE_ID = '${ISSUE_ID}';
const baseIssue = ${JSON.stringify(baseIssue)};
function snapshotFor(stage) {
  const issue = stage === 'ready'
    ? { ...baseIssue, status: 'In Review', state: 'in_review', labels: ['review ready'] }
    : stage === 'verifying'
      ? { ...baseIssue, status: 'Verifying On Main', state: 'verifying_on_main', labels: ['verifying-on-main'] }
      : { ...baseIssue, status: 'Done', state: 'done', labels: ['closed-out'] };
  return {
    sequence: stage === 'ready' ? 1 : stage === 'verifying' ? 2 : 3,
    agents: [],
    specialists: [],
    reviewStatuses: [
      stage === 'ready'
        ? { issueId: ISSUE_ID, reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'pending', readyForMerge: true, updatedAt: '2026-05-18T00:00:00.000Z' }
        : { issueId: ISSUE_ID, reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged', readyForMerge: false, updatedAt: '2026-05-18T00:01:00.000Z' },
    ],
    issues: [issue],
    channelPermissionRequests: [],
    timestamp: new Date().toISOString(),
  };
}
const transport = {
  request: async () => snapshotFor(window.__pan1190Stage || 'ready'),
  requestStream: async () => undefined,
  subscribe: () => () => undefined,
  dispose: () => undefined,
};
export function getTransport() { return transport; }
export function resetTransport() {}
export function ensureDashboardSession() { return Promise.resolve(); }
export async function dashboardMutationJsonHeaders() { return { 'Content-Type': 'application/json', 'x-panopticon-csrf-token': 'test-csrf' }; }
export class WsTransport {}
`,
  }));
}

async function routeDashboardApis(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/system/health', route => route.fulfill({ json: {
    severity: 'normal',
    updatedAt: new Date().toISOString(),
    summary: {
      cpuPercent: 0,
      loadAverage1m: 0,
      loadPerCore1m: 0,
      totalMemoryBytes: 1,
      usedMemoryBytes: 0,
      availableMemoryBytes: 1,
      memoryUsedPercent: 0,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 0,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
    },
    thresholds: {
      memoryAvailableWarningBytes: 0,
      memoryAvailableCriticalBytes: 0,
      swapUsedWarningPercent: 0,
      swapUsedCriticalPercent: 0,
      cpuLoadWarningPerCore: 0,
      cpuLoadCriticalPerCore: 0,
      overcommitWarningPercent: 0,
      overcommitCriticalPercent: 0,
    },
    reasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
  } }));
  await page.route('**/api/metrics/summary', route => route.fulfill({ json: {
    today: { totalCost: 0, agentCount: 0, activeCount: 0, stuckCount: 0, warningCount: 0 },
    topSpenders: { agents: [], issues: [] },
  } }));
  await page.route('**/api/registered-projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/issues/**/merge', async route => {
    await page.evaluate(() => {
      (window as typeof window & { __pan1190Stage?: string }).__pan1190Stage = 'verifying';
    });
    await route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/issues/**/close-out', async route => {
    await page.evaluate(() => {
      (window as typeof window & { __pan1190Stage?: string }).__pan1190Stage = 'closed-out';
    });
    await route.fulfill({ json: { workflow: 'close-out', issueId: ISSUE_ID, success: true, steps: [], duration: 1 } });
  });
  await page.route('**/api/version', route => route.fulfill({ json: { version: 'test' } }));
  await page.route('**/api/tracker-status', route => route.fulfill({ json: { primary: 'github', configured: [] } }));
  await page.route('**/api/cliproxy/status', route => route.fulfill({ json: { running: true, pid: 1234, checkedAt: new Date().toISOString() } }));
  await page.route('**/api/confirmations', route => route.fulfill({ json: [] }));
  await page.route('**/api/settings/available-models', route => route.fulfill({ json: {} }));
  await page.route('**/api/settings', route => route.fulfill({ json: { tts: { enabled: false, mutedIssues: [] } } }));
  await page.route('**/api/conversations', route => route.fulfill({ json: [] }));
  await page.route('**/api/specialists', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/costs/by-issue', route => route.fulfill({ json: { issues: [] } }));
  await page.route('**/api/cloister/**', route => route.fulfill({ json: { running: false, lastCheck: null, summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 }, agentsNeedingAttention: [] } }));
}

test.describe('PAN-1190 verify then close-out flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('drives merge to VERIFYING, then closes out and removes the issue from the board without reload', async ({ page }) => {
    await installMockTransport(page);
    await routeDashboardApis(page);

    await page.goto(`${BASE_URL}/`);
    await expect(page.getByText(ISSUE_ID)).toBeVisible();
    await page.getByTestId(`issue-card-${ISSUE_ID}`).getByRole('button', { name: 'Merge' }).click();
    await page.getByRole('button', { name: 'Merge' }).last().click();
    await expect(page.getByTestId('verifying-on-main-badge')).toBeVisible();
    await expect(page.getByTestId(`close-out-${ISSUE_ID}`)).toBeVisible();

    await page.getByTestId(`close-out-${ISSUE_ID}`).click();
    await page.getByRole('button', { name: 'Close Out' }).last().click();
    await expect(page.getByText(ISSUE_ID)).toHaveCount(0);
  });
});
