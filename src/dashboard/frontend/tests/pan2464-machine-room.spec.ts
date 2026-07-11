import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://127.0.0.1:3013';
const SCREENSHOT_PATH = 'test-results/pan2464-machine-room-1440.png';

test.describe('PAN-2464 Machine Room visual verification', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders the resources Machine Room and captures a 1440px screenshot', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await mockResourcesApi(page);
    await page.goto(`${DASHBOARD_URL}/resources`);
    await page.evaluate(() => {
      localStorage.setItem('overdeck.ui.theme', 'light');
    });
    await page.reload();
    await page.getByRole('button', { name: 'Toggle activity feed' }).click();

    const heading = page.getByRole('heading', { name: 'Machine Room' });
    const errorBoundary = page.getByText('The dashboard hit an error.');
    await Promise.race([
      heading.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
      errorBoundary.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
    ]);
    if (await errorBoundary.isVisible()) {
      throw new Error(`Dashboard error boundary rendered:\n${pageErrors.join('\n\n')}`);
    }

    await expect(heading).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('CPU').first()).toBeVisible();
    await expect(page.getByText('Memory').first()).toBeVisible();
    await expect(page.getByText('Spawn gate')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reclaim advisor' })).toBeVisible();
    await expect(page.getByTestId('stack-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Agents/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Core services/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Host processes/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Last 24h' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Resource history chart' })).toBeVisible();

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  });
});

async function mockResourcesApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.route('**/api/conversations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/registered-projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/session-trees**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trees: [] }) });
  });
  await page.route('**/api/git-activity', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ experimental: { experimentalFeatures: true } }),
    });
  });
  await page.route('**/api/confirmations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/conversations/pending-input', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/tracker-status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: [] }) });
  });
  await page.route('**/api/system/health', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(systemHealthPayload()) });
  });
  await page.route('**/api/version', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'test' }) });
  });
  await page.route('**/api/resources', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resourcesPayload()) });
  });
  await page.route('**/api/resources/history/24h', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(historyPayload()) });
  });
}

function resourcesPayload() {
  return {
    updatedAt: '2026-07-07T12:00:00.000Z',
    containers: [
      container('c-api', 'feature-pan-2464-api', 'running', 2.4 * 1024 ** 3),
      container('c-worker', 'feature-pan-2464-worker', 'paused', 1.1 * 1024 ** 3),
    ],
    agents: [{
      id: 'agent-pan-2464-work',
      issueId: 'PAN-2464',
      runtime: 'codex',
      model: 'gpt-5',
      status: 'running',
      startedAt: '2026-07-07T11:00:00.000Z',
      consecutiveFailures: 0,
      killCount: 0,
      role: 'work',
      resourceStats: {
        id: 'agent-pan-2464-work',
        issueId: 'PAN-2464',
        role: 'work',
        model: 'gpt-5',
        status: 'running',
        statusChip: { state: 'working', idleMinutes: 2, fanOut: false },
        rootPid: 1200,
        processCount: 5,
        cpuPercent: 18.4,
        memoryBytes: 1.6 * 1024 ** 3,
        burnUsdPerHour: 0,
        hypotheticalUsdPerHour: 2.2,
        totalUsd: 8.75,
      },
    }],
    hostVitals: {
      stale: false,
      cpu: { percent: 47, load: [2.1, 2.8, 3.4], spark: [31, 42, 38, 47, 44, 51] },
      mem: { usedBytes: 11 * 1024 ** 3, availableBytes: 5 * 1024 ** 3, swapUsedBytes: 512 * 1024 ** 2, swapTotalBytes: 8 * 1024 ** 3 },
      disk: { usedBytes: 420 * 1024 ** 3, freeBytes: 160 * 1024 ** 3, reclaimableBytes: 5 * 1024 ** 3 },
      docker: { containers: 7, running: 5, stacks: 2, networks: 6, networkPool: { used: 6, total: 31 }, stale: false },
      agents: { sessions: 3, active: 2, idleOver15m: 1, burnUsdPerHour: 0, hypotheticalUsdPerHour: 2.2, totalUsd: 8.75 },
    },
    spawnGate: { state: 'OPEN', reason: 'capacity available', pressure: 0.42, warnings: [] },
    stacks: [{
      id: 'PAN-2464',
      issueId: 'PAN-2464',
      issueTitle: 'Machine Room resources dashboard',
      composeProject: 'feature-pan-2464',
      serviceCount: 2,
      services: [
        container('c-api', 'feature-pan-2464-api', 'running', 2.4 * 1024 ** 3),
        container('c-worker', 'feature-pan-2464-worker', 'paused', 1.1 * 1024 ** 3),
      ],
      aggregates: { cpuPercent: 36.8, memoryBytes: 3.5 * 1024 ** 3, diskBytes: 5 * 1024 ** 3 },
      phase: 'review',
      idleMinutes: 18,
    }],
    reclaimCandidates: [{
      kind: 'stack',
      label: 'PAN-2464 stack',
      why: 'Merged stack with no live agent.',
      ramBytes: 3.5 * 1024 ** 3,
      diskBytes: 5 * 1024 ** 3,
      action: 'GET /api/resources/stacks/PAN-2464/teardown-estimate',
      issueId: 'PAN-2464',
    }],
    reclaimTotals: { ramBytes: 3.5 * 1024 ** 3, diskBytes: 5 * 1024 ** 3 },
    reclaimThresholdBytes: 1,
    forecast: {
      stacks: [{
        stackId: 'PAN-2464',
        issueId: 'PAN-2464',
        composeProject: 'feature-pan-2464',
        predictedRamBytes: 4.2 * 1024 ** 3,
        predictedLoad: 3.1,
        approximate: true,
        source: 'last-run-peak',
      }],
      headroom: { freeRamBytes: 5 * 1024 ** 3, loadHeadroom: 5.5 },
    },
    coreServices: [
      { id: 'dashboard', label: 'Dashboard server', status: 'running', cpuPercent: 3, memoryBytes: 512 * 1024 ** 2, memberCount: 1, eventLoopP99Ms: 42 },
      { id: 'deacon', label: 'Deacon', status: 'running', cpuPercent: 1, memoryBytes: 256 * 1024 ** 2, memberCount: 1, lastTickAgeSeconds: 12 },
      { id: 'support-fleet', label: 'Support fleet', status: 'running', cpuPercent: 4, memoryBytes: 768 * 1024 ** 2, memberCount: 2, members: ['traefik', 'pty-supervisor'] },
    ],
    hostProcesses: [{
      id: 'vitest:agent-pan-2464',
      family: 'vitest workers',
      label: 'vitest workers',
      owner: { label: 'spawned by agent-pan-2464', agentId: 'agent-pan-2464-work' },
      pidCount: 4,
      cpuPercent: 0,
      memoryBytes: 0,
      peakCpuPercent: 160,
      peakMemoryBytes: 2 * 1024 ** 3,
      retainedUntil: '2026-07-07T13:00:00.000Z',
      note: 'caused spike: Load 45',
    }],
  };
}

function historyPayload() {
  return {
    startedAt: '2026-07-06T12:00:00.000Z',
    cpu: [
      { ts: '2026-07-06T12:00:00.000Z', value: 25 },
      { ts: '2026-07-07T00:00:00.000Z', value: 52 },
      { ts: '2026-07-07T12:00:00.000Z', value: 38 },
    ],
    mem: [
      { ts: '2026-07-06T12:00:00.000Z', value: 48 },
      { ts: '2026-07-07T00:00:00.000Z', value: 63 },
      { ts: '2026-07-07T12:00:00.000Z', value: 58 },
    ],
    annotations: [{
      ts: '2026-07-07T00:00:00.000Z',
      targetKind: 'agent',
      targetId: 'agent-pan-2464-work',
      label: 'Agent memory spike',
    }],
  };
}

function systemHealthPayload() {
  return {
    updatedAt: '2026-07-07T12:00:00.000Z',
    severity: 'ok',
    reasons: [],
    summary: {
      cpuPercent: 47,
      loadPerCore1m: 0.72,
      usedMemoryBytes: 11 * 1024 ** 3,
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 5 * 1024 ** 3,
      memoryUsedPercent: 68,
      swapUsedPercent: 6,
      overcommitPercent: 72,
      overdeckMemoryBytes: 3.2 * 1024 ** 3,
      overdeckMemoryPercent: 20,
      workAgentCount: 3,
      containerCount: 7,
      leakedSpecialistCount: 0,
    },
    topConsumers: [],
    leakedSpecialists: [],
    smeeRelay: { configured: false, running: false, message: 'Not configured' },
  };
}

function container(id: string, name: string, status: 'running' | 'paused' | 'stopped', memoryUsage: number) {
  return {
    id,
    name,
    cpuPercent: 18.4,
    memoryUsage,
    memoryLimit: 4 * 1024 ** 3,
    memoryPercent: (memoryUsage / (4 * 1024 ** 3)) * 100,
    networkIn: 10 * 1024 ** 2,
    networkOut: 4 * 1024 ** 2,
    status,
    memLimitBytes: 4 * 1024 ** 3,
    memPercentOfLimit: Math.round((memoryUsage / (4 * 1024 ** 3)) * 100),
    oomKills24h: 0,
  };
}
