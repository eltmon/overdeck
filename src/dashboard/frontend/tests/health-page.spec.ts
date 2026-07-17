import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { expect, test, type Page } from '@playwright/test';

const GIB = 1024 ** 3;

interface ThrowawayDashboard {
  baseUrl: string;
  child: ChildProcessByStdio<null, Readable, Readable>;
  overdeckHome: string;
}

let dashboard: ThrowawayDashboard;

async function openPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a throwaway dashboard port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function startThrowawayDashboard(): Promise<ThrowawayDashboard> {
  const port = await openPort();
  const overdeckHome = await mkdtemp(resolve('.tmp-pan-2647-health-page-'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [resolve('dist/dashboard/server.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      DASHBOARD_URL: baseUrl,
      HOST: '127.0.0.1',
      OVERDECK_DISABLE_DEACON: '1',
      OVERDECK_HOME: overdeckHome,
      OVERDECK_NO_RESUME: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const instance = { baseUrl, child, overdeckHome };

  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Throwaway dashboard exited during boot (${child.exitCode}).\n${output}`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          await response.body?.cancel();
          return instance;
        }
      } catch {
        // The listener is not ready yet.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    throw new Error(`Throwaway dashboard did not listen within 120 seconds.\n${output}`);
  } catch (error) {
    await stopThrowawayDashboard(instance);
    throw error;
  }
}

async function stopThrowawayDashboard(instance: ThrowawayDashboard | undefined): Promise<void> {
  if (!instance) return;
  if (instance.child.exitCode === null) {
    instance.child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolveExit) => instance.child.once('exit', () => resolveExit())),
      new Promise<void>((resolveWait) => setTimeout(resolveWait, 5_000)),
    ]);
  }
  if (instance.child.exitCode === null) instance.child.kill('SIGKILL');
  await rm(instance.overdeckHome, { recursive: true, force: true });
}

function systemHealthFixture() {
  return {
    version: 2,
    state: 'healthy',
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state: 'healthy',
      platform: 'linux',
      reasons: [],
      metrics: {
        cpuPercent: 12.5,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.15,
        totalMemoryBytes: 64 * GIB,
        usedMemoryBytes: 24 * GIB,
        availableMemoryBytes: 40 * GIB,
        memoryUsedPercent: 37.5,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 4 * GIB,
        swapUsedPercent: 50,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 80 * GIB,
        commitLimitBytes: 64 * GIB,
        virtualCommitmentPercent: 125,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 40 * GIB,
      admittedWorkAgentCount: 0,
      reasons: [],
    },
    agents: [],
    services: [],
    topConsumers: [],
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.15,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 24 * GIB,
      availableMemoryBytes: 40 * GIB,
      memoryUsedPercent: 37.5,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 4 * GIB,
      swapUsedPercent: 50,
      committedMemoryBytes: 80 * GIB,
      commitLimitBytes: 64 * GIB,
      overcommitPercent: 125,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 3 * GIB,
      overdeckMemoryPercent: 4.7,
      smeeRelay: {
        configured: false,
        running: false,
        status: 'not_configured',
        message: 'Not configured',
      },
    },
  };
}

async function mockHealthPage(page: Page, agents: unknown[] = []): Promise<void> {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/deploy/staleness', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  await page.route('**/api/system/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...systemHealthFixture(), agents }),
    });
  });
  await page.route('**/api/health/agents', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agents) });
  });
  await page.route('**/api/services/tldr/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"daemons":[]}' });
  });
  await page.route('**/api/deacon/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        isRunning: true,
        config: { patrolIntervalMs: 60_000 },
        state: {
          specialists: {},
          patrolCycle: 1,
          lastPatrol: '2026-07-17T04:00:00.000Z',
        },
        lastPatrol: null,
      }),
    });
  });
  await page.route('**/api/specialists/projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  for (const path of [
    'conversations',
    'registered-projects',
    'confirmations',
    'conversations/pending-input',
    'git-activity',
  ]) {
    await page.route(`**/api/${path}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }
  await page.route('**/api/session-trees**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"trees":[]}' });
  });
  await page.route('**/api/settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"experimental":{"experimentalFeatures":true}}',
    });
  });
  await page.route('**/api/tracker-status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":[]}' });
  });
  await page.route('**/api/version', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"test"}' });
  });
}

test.describe('PAN-2647 Health page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.setTimeout(150_000);
    dashboard = await startThrowawayDashboard();
  });

  test.afterAll(async () => {
    await stopThrowawayDashboard(dashboard);
  });

  test('keeps host, Deacon, and neutral optional TLDR visible with zero agents', async ({ page }) => {
    await mockHealthPage(page);
    await page.goto(`${dashboard.baseUrl}/health`);

    await expect(page.getByRole('heading', { name: 'Host health' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Deacon', { exact: true })).toBeVisible();
    await expect(page.getByText('TLDR · Not configured (optional)')).toBeVisible();
    await expect(page.getByText('No agents to monitor')).toBeVisible();
    await expect(page.getByLabel('Wedged agents: 0')).toBeVisible();
  });

  test('renders a wedged agent by an accessible status name', async ({ page }) => {
    const agents = [{
      id: 'agent-wedged',
      status: 'wedged',
      reasons: [{
        code: 'agent.wedged',
        domain: 'agent',
        severity: 'critical',
        message: 'No progress since the last accepted activity.',
      }],
      lifecycle: 'active',
    }];
    await mockHealthPage(page, agents);
    await page.goto(`${dashboard.baseUrl}/health`);

    await expect(page.getByLabel('Wedged agents: 1')).toBeVisible();
    await expect(page.getByLabel('agent-wedged status: Wedged')).toBeVisible();
    await expect(page.getByText('No progress since the last accepted activity.')).toBeVisible();
  });

  test('degrades a failed system-health route to unavailable without a client exception', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    await mockHealthPage(page);
    await page.route('**/api/system/health', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'fixture unavailable',
      });
    });
    await page.goto(`${dashboard.baseUrl}/health`);

    await expect(page.getByRole('button', { name: 'Health unavailable · Retry' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Host health' })).toBeVisible();
    await expect(page.getByText('CPU unavailable')).toBeVisible();
    await expect(page.getByText('Memory unavailable')).toBeVisible();
    await expect(page.getByText('The dashboard hit an error.')).toHaveCount(0);
    expect(pageErrors, `Unexpected browser exceptions:\n${pageErrors.join('\n\n')}`).toEqual([]);
  });
});
