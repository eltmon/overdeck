import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

type ViteDevServer = {
  listen: () => Promise<void> | void;
  close: () => Promise<void> | void;
  httpServer?: { address: () => AddressInfo | string | null };
};

const require = createRequire(import.meta.url);
let vite: ViteDevServer;
let browser: Browser;
let baseUrl: string;

const now = '2026-05-18T00:00:00.000Z';

const issue = {
  id: 'PAN-1148',
  identifier: 'PAN-1148',
  title: 'Styleguide conformance issue',
  status: 'In Progress',
  state: 'in_progress',
  priority: 2,
  labels: ['styleguide'],
  url: 'https://example.com/PAN-1148',
  createdAt: now,
  updatedAt: now,
  project: { id: 'pan', name: 'Panopticon', color: 'var(--primary)' },
};

const agent = {
  id: 'agent-pan-1148',
  issueId: 'PAN-1148',
  role: 'work',
  status: 'running',
  runtime: 'claude-code',
  harness: 'claude-code',
  model: 'claude-opus-4-7',
  startedAt: now,
  lastActivity: now,
  consecutiveFailures: 0,
  killCount: 0,
};

const feature = {
  issueId: 'PAN-1148',
  title: 'Styleguide conformance issue',
  projectName: 'Panopticon',
  branch: 'feature/pan-1148',
  status: 'In Progress',
  stateLabel: 'In Progress',
  agentStatus: 'running',
  hasPlanning: true,
  hasPrd: true,
  hasState: true,
  isShadow: false,
  cost: 1.25,
  readyForMerge: false,
  sessions: [{ sessionId: 'agent-pan-1148', type: 'work', role: 'work', presence: 'active' }],
  resourceSources: ['workspace', 'branch'],
  resourceDetails: {
    hasWorkspace: true,
    localBranchCount: 1,
    remoteBranchCount: 1,
    tmuxSessionCount: 1,
    prs: [],
    hasVbrief: true,
    hasBeads: true,
    dockerContainerCount: 0,
  },
};

const snapshot = {
  sequence: 1,
  timestamp: now,
  agents: [agent],
  agentRuntimeById: {},
  reviewStatuses: [],
  resources: null,
  issues: [issue],
  channelPermissionRequests: [],
  scanProgress: null,
  enrichStats: null,
  enrichProgressBySessionId: {},
  embedProgressBySessionId: {},
};

async function newContext(): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(({ snapshotFixture, featureFixture }) => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify({ data: snapshotFixture, timestamp: new Date().toISOString() }));
    window.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
      const path = new URL(url, window.location.origin).pathname;
      const search = new URL(url, window.location.origin).search;
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

      if (path === '/api/dashboard/session') return json({ ok: true });
      if (path === '/api/version') return json({ version: 'test', supervisorUrl: null });
      if (path === '/api/tracker-status') return json({ primary: 'github', configured: [] });
      if (path === '/api/confirmations') return json([]);
      if (path === '/api/cloister/status') return json({
        running: true,
        lastCheck: new Date().toISOString(),
        summary: { active: 1, stale: 0, warning: 0, stuck: 0, total: 1 },
        agentsNeedingAttention: [],
      });
      if (path === '/api/settings') return json({ tts: { enabled: false } });
      if (path === '/api/tts/health') return json({ ok: true, queue: 0, model: 'test-tts' });
      if (path === '/api/deacon/status') return json({
        isRunning: true,
        config: { patrolIntervalMs: 15_000 },
        state: { specialists: {}, lastPatrol: new Date().toISOString(), patrolCycle: 1 },
        lastPatrol: { cycle: 1, timestamp: new Date().toISOString(), actions: [], massDeathDetected: false },
      });
      if (path === '/api/system/health') return json({
        severity: 'normal',
        updatedAt: new Date().toISOString(),
        summary: {
          cpuPercent: 1,
          loadAverage1m: 0.1,
          loadPerCore1m: 0.01,
          totalMemoryBytes: 16_000_000_000,
          usedMemoryBytes: 4_000_000_000,
          availableMemoryBytes: 12_000_000_000,
          memoryUsedPercent: 25,
          swapTotalBytes: 0,
          swapUsedBytes: 0,
          swapUsedPercent: 0,
          overcommitPercent: 0,
          agentCount: 1,
          workAgentCount: 1,
          planningAgentCount: 0,
          specialistSessionCount: 0,
          leakedSpecialistCount: 0,
          containerCount: 0,
          containerMemoryBytes: 0,
          panopticonMemoryBytes: 128_000_000,
          panopticonMemoryPercent: 1,
        },
        thresholds: {
          memoryAvailableWarningBytes: 4_000_000_000,
          memoryAvailableCriticalBytes: 2_000_000_000,
          swapUsedWarningPercent: 20,
          swapUsedCriticalPercent: 50,
          cpuLoadWarningPerCore: 1,
          cpuLoadCriticalPerCore: 2,
          overcommitWarningPercent: 150,
          overcommitCriticalPercent: 200,
        },
        reasons: [],
        agents: [],
        leakedSpecialists: [],
        topConsumers: [],
      });
      if (path === '/api/specialists') return json({ projects: [] });
      if (path === '/api/cliproxy/status') return json({ running: true, pid: null, checkedAt: new Date().toISOString() });
      if (path === '/api/costs/by-issue') return json({ issues: [{ issueId: 'PAN-1148', totalCost: 1.25 }] });
      if (path === '/api/costs/stream') return json({
        events: [],
        byIssue: { 'PAN-1148': [{ ts: new Date().toISOString(), model: 'opus', provider: 'anthropic', cost: 1.25, tokens: 4200 }] },
        count: 1,
      });
      if (path === '/api/costs/trends') return json({ trends: [{ totalCost: 1.25, totalTokens: 4200 }] });
      if (path === '/api/metrics/summary') return json({
        today: { totalCost: 1.25, agentCount: 1, activeCount: 1, stuckCount: 0, warningCount: 0 },
        topSpenders: { agents: [{ agentId: 'agent-pan-1148', cost: 1.25 }], issues: [{ issueId: 'PAN-1148', cost: 1.25 }] },
      });
      if (path === '/api/issues/resource-allocated') return json([featureFixture]);
      if (path === '/api/registered-projects') return json([{ key: 'pan', name: 'Panopticon', path: '/tmp/panopticon' }]);
      if (path === '/api/session-trees') return json({ trees: [] });
      if (path === '/api/conversations') return json([]);
      if (path === '/api/conversations/cost' || path === '/api/conversations/cost/by-workspace') return json({ totalCost: 0, entries: [] });
      if (path === '/api/flywheel/runs') return json([]);
      return json(search ? { search } : {});
    };
  }, { snapshotFixture: snapshot, featureFixture: feature });
  return context;
}

async function openRoute(path: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}${path}`);
  return { context, page };
}

beforeAll(async () => {
  const frontendRoot = join(process.cwd(), 'src/dashboard/frontend');
  const vitePath = require.resolve('vite', { paths: [frontendRoot] });
  const { createServer } = await import(vitePath) as { createServer: (options: Record<string, unknown>) => Promise<ViteDevServer> };
  vite = await createServer({
    root: frontendRoot,
    plugins: [{
      name: 'styleguide-empty-index-css',
      enforce: 'pre',
      transform(_code: string, id: string) {
        return id.endsWith('/src/index.css') ? { code: '', map: null } : null;
      },
    }],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await vite.listen();
  const address = vite.httpServer?.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
});

describe('styleguide rendered surface conformance', () => {
  it('renders shared primitives on Pipeline, Board, Command Deck, and Agents routes', async () => {
    const pipeline = await openRoute('/pipeline');
    await expect.poll(() => pipeline.page.locator('[data-component="top-bar"]').count()).toBeGreaterThan(0);
    await expect.poll(() => pipeline.page.locator('[data-component="phase-header"]').count()).toBeGreaterThan(0);
    await expect.poll(() => pipeline.page.locator('[data-component="issue-row"][data-issue-id="PAN-1148"]').count()).toBe(1);
    await expect.poll(() => pipeline.page.locator('[data-component="verb-badge"]').count()).toBeGreaterThan(0);
    await pipeline.context.close();

    const board = await openRoute('/board');
    await expect.poll(() => board.page.locator('[data-component="issue-card"][data-issue-id="PAN-1148"]').count()).toBe(1);
    await expect.poll(() => board.page.locator('[data-component="verb-badge"]').count()).toBeGreaterThan(0);
    await board.context.close();

    const commandDeck = await openRoute('/command-deck');
    await commandDeck.page.getByText('Panopticon', { exact: true }).nth(1).click();
    await expect.poll(() => commandDeck.page.locator('[data-component="issue-row"][data-issue-id="PAN-1148"][data-variant="command-deck"]').count()).toBe(1);
    await expect.poll(() => commandDeck.page.locator('[data-component="verb-badge"]').count()).toBeGreaterThan(0);
    await commandDeck.context.close();

    const agents = await openRoute('/agents');
    await expect.poll(() => agents.page.locator('[data-component="agent-card"][data-agent-id="agent-pan-1148"]').count()).toBe(1);
    await expect.poll(() => agents.page.locator('[data-component="verb-badge"]').count()).toBeGreaterThan(0);
    await agents.context.close();

    const drawer = await openRoute('/pipeline?issue=PAN-1148&tab=overview');
    await expect.poll(() => drawer.page.locator('[data-component="drawer-action-bar"]').count()).toBe(1);
    await expect.poll(() => drawer.page.locator('[data-component="shared-button"][data-variant="ghost"]').count()).toBeGreaterThan(0);
    await expect.poll(() => drawer.page.locator('[data-component="shared-button"][data-variant="primary"]').count()).toBeGreaterThan(0);
    const ghostBorder = await drawer.page.locator('[data-testid="drawer-action-reset"]').evaluate((node) => getComputedStyle(node).borderColor);
    const primaryShadow = await drawer.page.locator('[data-testid="drawer-action-merge"]').evaluate((node) => getComputedStyle(node).boxShadow);
    expect(ghostBorder).not.toBe('rgba(0, 0, 0, 0)');
    expect(primaryShadow).toContain('rgba(255, 255, 255, 0.06)');
    await drawer.context.close();
  }, 45_000);

  it('agents page TopBar segmented control switches views and Start agent navigates to board', async () => {
    const { context, page } = await openRoute('/agents');

    await expect.poll(() => page.locator('[data-component="top-bar-segmented-control"]').count()).toBe(1);
    await expect.poll(() => page.locator('[data-component="agent-card"]').count()).toBe(1);

    await page.getByRole('button', { name: 'table' }).click();
    await expect.poll(() => page.url()).toContain('view=table');
    await expect.poll(() => page.locator('[data-component="agents-coming-soon"]').count()).toBe(1);
    await expect.poll(() => page.locator('[data-component="agent-card"]').count()).toBe(0);

    await page.getByRole('button', { name: 'timeline' }).click();
    await expect.poll(() => page.url()).toContain('view=timeline');
    await expect.poll(() => page.locator('[data-component="agents-coming-soon"]').count()).toBe(1);

    await page.getByRole('button', { name: 'grid' }).click();
    await expect.poll(() => page.url()).not.toContain('view=');
    await expect.poll(() => page.locator('[data-component="agent-card"]').count()).toBe(1);

    await page.getByRole('button', { name: 'Start agent' }).click();
    await expect.poll(() => page.url()).toBe(`${baseUrl}/board`);

    await context.close();
  }, 45_000);

  it('agents page Open issue scrolls drawer to active-agent section', async () => {
    const { context, page } = await openRoute('/agents');

    await expect.poll(() => page.locator('[data-component="agent-card"]').count()).toBe(1);
    await page.getByText('Open issue').click();

    await expect.poll(() => page.locator('[data-testid="issue-drawer"]').count()).toBe(1);
    await expect.poll(() => page.locator('#active-agent').count()).toBe(1);

    const activeAgent = page.locator('#active-agent');
    const isInViewport = await activeAgent.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const parent = node.closest('[class*="overflow-auto"]');
      if (!parent) return false;
      const parentRect = parent.getBoundingClientRect();
      return rect.top >= parentRect.top && rect.bottom <= parentRect.bottom;
    });
    expect(isInViewport).toBe(true);

    await context.close();
  }, 45_000);
});
