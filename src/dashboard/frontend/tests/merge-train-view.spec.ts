import { test, expect } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3010';

const readyGeneration = {
  name: 'uat/pan-otter-0612',
  status: 'ready',
  baseSha: 'abc',
  createdAt: '2026-06-12T12:00:00.000Z',
  updatedAt: '2026-06-12T12:00:00.000Z',
  members: [
    { issueId: 'PAN-1', title: 'Batch-ready feature', branch: 'feature/pan-1', mergeOrder: 1, acceptanceCriteria: [{ title: 'Verify the feature works', status: 'pending' }] },
  ],
  heldOut: [],
  resolutions: [],
  stack: { status: 'absent', frontendUrl: 'https://uat-pan-otter-0612.pan.localhost' },
};

test.describe('multi-project merge train view', () => {
  test('renders live generations without an active flywheel run and persists project filter', async ({ page }) => {
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = '#pan-recovery-overlay { display: none !important; pointer-events: none !important; }';
      document.documentElement.appendChild(style);
    });

    await page.route('**/api/version', (route) => route.fulfill({ json: { version: 'test', supervisorUrl: null } }));
    await page.route('**/api/flywheel/current', (route) => route.fulfill({ json: null }));
    await page.route('**/api/flywheel/runs?limit=1', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/flywheel/runs?limit=10', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/flywheel/config', (route) => route.fulfill({ json: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: true } }));
    await page.route('**/api/flywheel/auto-merge/pending', (route) => route.fulfill({ json: { pending: [] } }));
    await page.route('**/api/merge-train/generations', (route) => route.fulfill({
      json: [
        { projectKey: 'pan', projectName: 'Panopticon', generations: [readyGeneration] },
        { projectKey: 'mind', projectName: 'Mind', generations: [] },
      ],
    }));
    await page.route('**/api/merge-train/queues', (route) => route.fulfill({
      json: [
        {
          projectKey: 'pan',
          projectName: 'Panopticon',
          enabled: true,
          queue: [{ issueId: 'PAN-1', title: 'Batch-ready feature', branchName: 'feature/pan-1', mergeOrder: 1, conflictsWith: [] }],
        },
        {
          projectKey: 'mind',
          projectName: 'Mind',
          enabled: false,
          queue: [{ issueId: 'MIN-1', title: 'Other project feature', branchName: 'feature/min-1', mergeOrder: 1, conflictsWith: [] }],
        },
      ],
    }));

    await page.goto(`${DASHBOARD_URL}/flywheel`);

    await expect(page.getByText('No active run', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('pan-otter-0612', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('MIN-1', { exact: true }).first()).toBeVisible();

    await page.getByRole('region', { name: 'UAT batches' }).getByRole('button', { name: 'Mind', exact: true }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(page.getByText('pan-otter-0612', { exact: true })).toHaveCount(0);
    await expect(page.getByText('MIN-1', { exact: true }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('merge-train.projectFilter'))).toBe('mind');

    await page.reload();
    await expect(page.getByText('MIN-1', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('pan-otter-0612', { exact: true })).toHaveCount(0);
  });
});
