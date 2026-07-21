import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { expect, test, type Page } from '@playwright/test';

const GIB = 1024 ** 3;
const SCREENSHOT_DIR = resolve('test-results', 'pan-2647');

interface ThrowawayDashboard {
  baseUrl: string;
  child: ChildProcessByStdio<null, Readable, Readable>;
  logs: () => string;
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
  const overdeckHome = await mkdtemp(resolve('.tmp-pan-2647-health-'));
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
  const instance = { baseUrl, child, logs: () => output, overdeckHome };

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

function systemHealthFixture(state: 'measuring' | 'healthy' | 'unavailable' = 'healthy') {
  const unavailable = state === 'unavailable';
  const measuring = state === 'measuring';
  const metrics = {
    cpuPercent: unavailable || measuring ? null : 12.5,
    loadAverage1m: unavailable || measuring ? null : 1.2,
    loadPerCore1m: unavailable || measuring ? null : 0.15,
    totalMemoryBytes: unavailable || measuring ? null : 64 * GIB,
    usedMemoryBytes: unavailable || measuring ? null : 24 * GIB,
    availableMemoryBytes: unavailable || measuring ? null : 40 * GIB,
    memoryUsedPercent: unavailable || measuring ? null : 37.5,
    memoryPressureSomeAvg10: unavailable || measuring ? null : 0,
    memoryPressureFullAvg10: unavailable || measuring ? null : 0,
    memoryPressureFreePercent: null,
    swapTotalBytes: unavailable || measuring ? null : 8 * GIB,
    swapUsedBytes: unavailable || measuring ? null : 4 * GIB,
    swapUsedPercent: unavailable || measuring ? null : 50,
    swapActivityBytesPerMinute: unavailable || measuring ? null : 0,
    committedMemoryBytes: unavailable || measuring ? null : 80 * GIB,
    commitLimitBytes: unavailable || measuring ? null : 64 * GIB,
    virtualCommitmentPercent: unavailable || measuring ? null : 125,
  };
  const unavailableReason = unavailable ? [{
    code: 'system.health_snapshot.unavailable',
    domain: 'host',
    severity: 'critical',
    message: 'The system health snapshot is unavailable.',
  }] : [];

  return {
    version: 2,
    state,
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: measuring ? 1_000 : 15_000,
    host: {
      state,
      platform: unavailable ? 'unsupported' : 'linux',
      reasons: unavailableReason,
      metrics,
    },
    admission: {
      state: unavailable || measuring ? 'unavailable' : 'open',
      availableMemoryBytes: unavailable || measuring ? null : 40 * GIB,
      admittedWorkAgentCount: 2,
      reasons: [],
    },
    agents: [],
    services: [{
      id: 'smee-relay',
      label: 'Webhook relay',
      required: false,
      status: 'not_configured',
      message: 'Not configured',
      reasons: [],
    }],
    topConsumers: [],
    summary: {
      cpuPercent: unavailable || measuring ? 0 : 12.5,
      loadAverage1m: unavailable || measuring ? 0 : 1.2,
      loadPerCore1m: unavailable || measuring ? 0 : 0.15,
      totalMemoryBytes: unavailable || measuring ? 0 : 64 * GIB,
      usedMemoryBytes: unavailable || measuring ? 0 : 24 * GIB,
      availableMemoryBytes: unavailable || measuring ? 0 : 40 * GIB,
      memoryUsedPercent: unavailable || measuring ? 0 : 37.5,
      swapTotalBytes: unavailable || measuring ? 0 : 8 * GIB,
      swapUsedBytes: unavailable || measuring ? 0 : 4 * GIB,
      swapUsedPercent: unavailable || measuring ? 0 : 50,
      committedMemoryBytes: unavailable || measuring ? 0 : 80 * GIB,
      commitLimitBytes: unavailable || measuring ? 0 : 64 * GIB,
      overcommitPercent: unavailable || measuring ? 0 : 125,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 3 * GIB,
      overdeckMemoryPercent: unavailable || measuring ? 0 : 4.7,
      smeeRelay: {
        configured: false,
        running: false,
        status: 'not_configured',
        message: 'Not configured',
      },
    },
  };
}

async function mockAppShell(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/deploy/staleness', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
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

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((selectedTheme) => {
    localStorage.setItem('overdeck.ui.theme', selectedTheme);
  }, theme);
  await page.reload();
}

async function assertNoClientException(page: Page, errors: string[]): Promise<void> {
  await expect(page.getByText('The dashboard hit an error.')).toHaveCount(0);
  expect(errors, `Unexpected browser exceptions:\n${errors.join('\n\n')}`).toEqual([]);
}

test.describe('PAN-2647 system health pill', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.setTimeout(150_000);
    expect(process.versions.node.split('.')[0]).toBe('22');
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    dashboard = await startThrowawayDashboard();
  });

  test.afterAll(async () => {
    await stopThrowawayDashboard(dashboard);
  });

  test('boots the built Node 22 dashboard and serves every retained health projection', async () => {
    for (const path of [
      '/api/system/health',
      '/api/godview/system-health',
      '/api/deploy/staleness',
      '/api/health/agents',
      '/api/resources',
    ]) {
      const response = await fetch(`${dashboard.baseUrl}${path}`);
      expect(response.ok, `${path} returned ${response.status}`).toBe(true);
      await response.json();
    }

    const logs = dashboard.logs();
    expect(logs).toContain('Dashboard listening on http://127.0.0.1:');
    expect(logs).not.toMatch(
      /ERR_REQUIRE_CYCLE_MODULE|Cannot require\(\) ES Module.*cycle|FiberFailure|Effect layer.*(?:failed|failure)|Service not found/i,
    );
  });

  test('moves from first-run measuring to healthy without treating historical swap as pressure', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await mockAppShell(page);
    await page.addInitScript(() => {
      if (localStorage.getItem('overdeck.ui.theme') === null) {
        localStorage.setItem('overdeck.ui.theme', 'light');
      }
    });
    let requestCount = 0;
    await page.route('**/api/system/health', async (route) => {
      const state = requestCount++ === 0 ? 'measuring' : 'healthy';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemHealthFixture(state)),
      });
    });

    await page.goto(`${dashboard.baseUrl}/health`);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Measuring system health…' })).toBeVisible();
    const healthyPill = page.getByRole('button', { name: 'Healthy · 40 GB available' });
    await expect(healthyPill).toBeVisible({ timeout: 5_000 });
    await healthyPill.click();

    const dialog = page.getByRole('dialog', { name: 'System health' });
    await expect(dialog.getByText('50.0%')).toBeVisible();
    await expect(dialog.getByText('Overcommit 125.0%')).toBeVisible();
    await expect(dialog.getByText(/Critical/)).toHaveCount(0);
    await expect(dialog.getByText(/Warning/)).toHaveCount(0);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'system-health-light.png'), fullPage: true });

    await page.getByRole('button', { name: 'Close system health' }).click();
    await setTheme(page, 'dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await healthyPill.click();
    await expect(page.getByRole('dialog', { name: 'System health' })).toBeVisible();
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'system-health-dark.png'), fullPage: true });
    await assertNoClientException(page, browserErrors);
  });

  test('retains specialist, agent, and container cleanup actions with reversible leaked focus', async ({ page }) => {
    const requests: string[] = [];
    const fixture = systemHealthFixture('healthy');
    const actionFixture = {
      ...fixture,
      topConsumers: [
        {
          id: 'specialist-review-agent',
          label: 'specialist-review-agent',
          type: 'specialist',
          memoryBytes: 3 * GIB,
          memoryGb: 3,
          currentIssue: 'PAN-2647',
          leaked: true,
          killTarget: {
            kind: 'specialist',
            projectKey: 'overdeck',
            issueId: 'PAN-2647',
            specialistType: 'review-agent',
          },
        },
        {
          id: 'agent-pan-2647',
          label: 'agent-pan-2647',
          type: 'agent',
          memoryBytes: GIB,
          memoryGb: 1,
          issueId: 'PAN-2647',
          killTarget: { kind: 'agent', agentId: 'agent-pan-2647' },
        },
        {
          id: 'abcdef123456',
          label: 'overdeck-feature-pan-2647-api-1',
          type: 'container',
          memoryBytes: 2 * GIB,
          memoryGb: 2,
          killTarget: { kind: 'container', containerId: 'abcdef123456' },
        },
      ],
      summary: {
        ...fixture.summary,
        agentCount: 1,
        workAgentCount: 1,
        specialistSessionCount: 1,
        leakedSpecialistCount: 1,
        containerCount: 1,
        containerMemoryBytes: 2 * GIB,
      },
    };

    await mockAppShell(page);
    await page.route('**/api/system/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(actionFixture),
      });
    });
    for (const pattern of [
      '**/api/specialists/overdeck/PAN-2647/review-agent/kill',
      '**/api/agents/agent-pan-2647',
      '**/api/resources/docker/container/abcdef123456',
    ]) {
      await page.route(pattern, async (route) => {
        requests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"success":true,"ok":true}',
        });
      });
    }

    await page.goto(`${dashboard.baseUrl}/health`);
    await page.getByRole('button', { name: 'Healthy · 40 GB available' }).click();

    await page.getByTitle('Kill specialist specialist-review-agent').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Kill' }).click();
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: 'Show all' }).click();

    await page.getByTitle('Kill agent-pan-2647').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Kill' }).click();
    await expect.poll(() => requests.length).toBe(2);

    await page.getByTitle('Remove container overdeck-feature-pan-2647-api-1').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(() => requests.length).toBe(3);

    expect(requests.some((url) => url.includes('/api/specialists/overdeck/PAN-2647/review-agent/kill'))).toBe(true);
    expect(requests.some((url) => url.includes('/api/agents/agent-pan-2647'))).toBe(true);
    expect(requests.some((url) => url.includes('/api/resources/docker/container/abcdef123456'))).toBe(true);
  });

  test('keeps the popover inside a 320px viewport and dismissible', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await mockAppShell(page);
    await page.route('**/api/system/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemHealthFixture('healthy')),
      });
    });

    await page.goto(`${dashboard.baseUrl}/health`);
    const trigger = page.getByRole('button', { name: 'Healthy · 40 GB available' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'System health' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'system-health-narrow-320.png'), fullPage: true });

    await page.getByRole('button', { name: 'Close system health' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
