import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, symlink, unlink } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
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
let linkedFrontendNodeModules = false;
const linkedFrontendPackages: string[] = [];
const projectRoot = process.cwd();
const frontendRoot = join(projectRoot, 'src/dashboard/frontend');
const bootReconciliationSourceFiles = [
  join(frontendRoot, 'src/components/BootReconciliationModal.tsx'),
  join(frontendRoot, 'src/components/GraceCountdown.tsx'),
];
const forbiddenBootReconciliationColorClass = /\b(?:bg|text|border)-(?:neutral|orange|emerald|gray|zinc|sky|red)-|\btext-(?:white|black)\b/g;
const packageResolutionRoots = [
  frontendRoot,
  projectRoot,
  join(projectRoot, 'node_modules/.bun/node_modules'),
  resolve(projectRoot, '../..'),
  resolve(projectRoot, '../../node_modules/.bun/node_modules'),
];

function resolvePackage(specifier: string): string {
  return require.resolve(specifier, { paths: packageResolutionRoots });
}

function resolvePackageDir(specifier: string): string {
  if (specifier === '@overdeck/contracts') {
    return join(projectRoot, 'packages/contracts');
  }
  try {
    const packageJsonPath = resolvePackage(`${specifier}/package.json`);
    return packageJsonPath.slice(0, -'/package.json'.length);
  } catch {
    try {
      const entryPath = resolvePackage(specifier);
      const nodeModulesPart = `/node_modules/${specifier}/`;
      const index = entryPath.lastIndexOf(nodeModulesPart);
      if (index !== -1) return entryPath.slice(0, index + nodeModulesPart.length - 1);
    } catch {
      // Fall through to filesystem probing below.
    }
    for (const root of packageResolutionRoots) {
      const packagePath = join(root, ...specifier.split('/'));
      if (existsSync(packagePath)) return packagePath;
    }
    throw new Error(`Unable to resolve package root for ${specifier}`);
  }
}

function resolvePackageStoreRoot(): string {
  for (const root of packageResolutionRoots) {
    try {
      require.resolve('react/package.json', { paths: [root] });
      return root;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Unable to resolve frontend package store root');
}

async function ensureFrontendNodeModules(): Promise<void> {
  const nodeModulesPath = join(frontendRoot, 'node_modules');
  try {
    await lstat(nodeModulesPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await symlink(resolvePackageStoreRoot(), nodeModulesPath, 'dir');
    linkedFrontendNodeModules = true;
    return;
  }

  const packageJson = JSON.parse(await readFile(join(frontendRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  for (const dependency of dependencies) {
    const packagePath = join(nodeModulesPath, ...dependency.split('/'));
    try {
      await lstat(packagePath);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dependency.startsWith('@')) {
      await mkdir(join(nodeModulesPath, dependency.split('/')[0]), { recursive: true });
    }
    await symlink(resolvePackageDir(dependency), packagePath, 'dir');
    linkedFrontendPackages.push(packagePath);
  }
}

const renderPoll = { timeout: 10_000, interval: 100 };
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
  project: { id: 'pan', name: 'Overdeck', color: 'var(--primary)' },
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
  projectName: 'Overdeck',
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
  specialists: [],
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
      if (path === '/api/boot-reconciliation') return json({ decision: null, perAgent: {}, decidedAt: null, bootId: null, graceDeadline: null, set: [] });
      if (path === '/api/cloister/status') return json({
        running: true,
        lastCheck: new Date().toISOString(),
        summary: { active: 1, stale: 0, warning: 0, stuck: 0, total: 1 },
        agentsNeedingAttention: [],
      });
      // The /agents route is a gated experimental nav surface — enable the
      // flag so the route renders its FleetAgentsView instead of redirecting
      // to /home. See src/lib/experimentalFeatures.ts (EXPERIMENTAL_TAB_IDS).
      if (path === '/api/settings') return json({ tts: { enabled: false }, experimental: { experimentalFeatures: true } });
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
          overdeckMemoryBytes: 128_000_000,
          overdeckMemoryPercent: 1,
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
      if (path === '/api/backlog/issue-state') return json({
        issueId: new URL(url, window.location.origin).searchParams.get('issueId') ?? 'PAN-1148',
        state: {
          ready: true,
          planned: true,
          parked: false,
          vetoed: false,
          blocksMain: false,
          inPipeline: true,
          released: true,
          objection: false,
          gate: 'auto',
        },
        gate: 'auto',
        planning: 'auto',
        inSequence: false,
      });
      if (path === '/api/registered-projects') return json([{ key: 'pan', name: 'Overdeck', path: '/tmp/overdeck' }]);
      if (path === '/api/session-trees') return json({ trees: [] });
      if (path === '/api/conversations/pending-input') return json([]);
      if (path === '/api/conversations') return json([]);
      if (path === '/api/conversations/pending-input') return json([]);
      if (path === '/api/git-activity') return json([]);
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
  await ensureFrontendNodeModules();
  const vitePath = resolvePackage('vite');
  const reactPath = resolvePackage('@vitejs/plugin-react');
  const { createServer } = await import(vitePath) as { createServer: (options: Record<string, unknown>) => Promise<ViteDevServer> };
  const { default: react } = await import(reactPath) as { default: () => unknown };
  vite = await createServer({
    root: frontendRoot,
    configFile: false,
    plugins: [react(), {
      name: 'styleguide-mock-ws-transport',
      enforce: 'pre',
      transform(_code: string, id: string) {
        if (!id.includes('/src/lib/wsTransport.ts')) return null;
        return {
          code: `
            import { Effect, Stream } from 'effect';

            function cachedSnapshot() {
              const raw = localStorage.getItem('pan-snapshot-cache-v1');
              return raw ? JSON.parse(raw).data : null;
            }

            const client = new Proxy({}, {
              get(_target, prop) {
                const method = String(prop);
                if (method === 'pan.getSnapshot') return () => Effect.succeed(cachedSnapshot());
                if (method === 'pan.replayEvents') return () => Effect.succeed([]);
                if (method.startsWith('pan.subscribe')) return () => Stream.empty;
                return () => Effect.succeed(null);
              },
            });

            export class WsTransport {
              async request(execute) { return Effect.runPromise(execute(client)); }
              async requestStream(connect, listener) {
                await Effect.runPromise(Stream.runForEach(connect(client), (value) => Effect.sync(() => listener(value))));
              }
              subscribe() { return () => undefined; }
              dispose() {}
            }

            let transport = new WsTransport();
            export function getTransport() { return transport; }
            export function resetTransport() { transport = new WsTransport(); }
            export function ensureDashboardSession() { return Promise.resolve(); }
            export async function dashboardMutationJsonHeaders() { return { 'Content-Type': 'application/json' }; }
            export function subscribeFlywheelStatus() { return () => undefined; }
          `,
          map: null,
        };
      },
    }, {
      name: 'styleguide-empty-index-css',
      enforce: 'pre',
      transform(_code: string, id: string) {
        return id.endsWith('/src/index.css') ? { code: '', map: null } : null;
      },
    }],
    server: { host: '127.0.0.1', port: 0, watch: null },
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
  await Promise.all(linkedFrontendPackages.map((packagePath) => unlink(packagePath)));
  if (linkedFrontendNodeModules) {
    await unlink(join(frontendRoot, 'node_modules'));
  }
});

describe('styleguide rendered surface conformance', () => {
  it('keeps boot reconciliation countdown surfaces on semantic color tokens', async () => {
    const violations: string[] = [];
    for (const file of bootReconciliationSourceFiles) {
      const source = await readFile(file, 'utf8');
      const matches = source.match(forbiddenBootReconciliationColorClass) ?? [];
      violations.push(...matches.map((match) => `${file}: ${match}`));
    }

    expect(violations).toEqual([]);
  });

  it('renders shared primitives on Pipeline, Board, Command Deck, and Agents routes', async () => {
    const pipeline = await openRoute('/pipeline');
    await expect.poll(() => pipeline.page.locator('[data-component="top-bar"]').count(), renderPoll).toBeGreaterThan(0);
    await expect.poll(() => pipeline.page.locator('[data-component="phase-header"]').count(), renderPoll).toBeGreaterThan(0);
    await expect.poll(() => pipeline.page.locator('[data-component="issue-row"][data-issue-id="PAN-1148"]').count(), renderPoll).toBe(1);
    await expect.poll(() => pipeline.page.locator('[data-component="verb-badge"]').count(), renderPoll).toBeGreaterThan(0);
    await pipeline.context.close();

    const board = await openRoute('/board');
    await expect.poll(() => board.page.locator('[data-component="issue-card"][data-issue-id="PAN-1148"]').count(), renderPoll).toBe(1);
    await expect.poll(() => board.page.locator('[data-component="verb-badge"]').count(), renderPoll).toBeGreaterThan(0);
    await board.context.close();

    const commandDeck = await openRoute('/command-deck');
    await commandDeck.page.getByText('Overdeck', { exact: true }).nth(1).click();
    // CommandDeck uses FeatureItem (not IssueRow) since the ProjectTree remodel
    await expect.poll(() => commandDeck.page.locator('[data-component="feature-item"][data-issue-id="PAN-1148"]').count(), renderPoll).toBe(1);
    await commandDeck.context.close();

    const agents = await openRoute('/agents');
    await expect.poll(() => agents.page.locator('[data-component="agent-card"][data-agent-id="agent-pan-1148"]').count(), renderPoll).toBe(1);
    await expect.poll(() => agents.page.locator('[data-component="verb-badge"]').count(), renderPoll).toBeGreaterThan(0);
    await agents.context.close();

    const drawer = await openRoute('/pipeline?issue=PAN-1148&tab=overview');
    await expect.poll(() => drawer.page.locator('[data-component="drawer-action-bar"]').count(), renderPoll).toBe(1);
    const drawerActionBar = drawer.page.locator('[data-component="drawer-action-bar"]');
    await expect.poll(() => drawerActionBar.locator('[data-testid="issue-action-menu"]').count(), renderPoll).toBe(1);
    await expect.poll(() => drawerActionBar.locator('[data-testid="issue-action-tell"]').count(), renderPoll).toBe(1);
    await expect.poll(() => drawerActionBar.locator('[data-testid="issue-action-doneWork"]').count(), renderPoll).toBe(1);
    await expect.poll(() => drawerActionBar.locator('[data-testid="issue-action-overflow-button"]').count(), renderPoll).toBe(1);
    await expect.poll(() => drawerActionBar.locator('[data-testid="drawer-action-reset"]').count(), renderPoll).toBe(0);
    await expect.poll(() => drawerActionBar.locator('[data-testid="drawer-action-stop"]').count(), renderPoll).toBe(0);
    await drawer.context.close();
  }, 45_000);

  it('agents page TopBar segmented control switches views and Start agent navigates to board', async () => {
    const { context, page } = await openRoute('/agents');

    await expect.poll(() => page.locator('[data-component="top-bar-segmented-control"]').count(), renderPoll).toBe(1);
    await expect.poll(() => page.locator('[data-component="agent-card"]').count(), renderPoll).toBe(1);

    await page.getByRole('button', { name: 'table' }).click();
    await expect.poll(() => page.url(), renderPoll).toContain('view=table');
    await expect.poll(() => page.locator('[data-component="agents-coming-soon"]').count(), renderPoll).toBe(1);
    await expect.poll(() => page.locator('[data-component="agent-card"]').count(), renderPoll).toBe(0);

    await page.getByRole('button', { name: 'timeline' }).click();
    await expect.poll(() => page.url(), renderPoll).toContain('view=timeline');
    await expect.poll(() => page.locator('[data-component="agents-coming-soon"]').count(), renderPoll).toBe(1);

    await page.getByRole('button', { name: 'grid' }).click();
    await expect.poll(() => page.url(), renderPoll).not.toContain('view=');
    await expect.poll(() => page.locator('[data-component="agent-card"]').count(), renderPoll).toBe(1);

    await page.getByRole('button', { name: 'Start agent' }).click();
    await expect.poll(() => page.url(), renderPoll).toBe(`${baseUrl}/board`);

    await context.close();
  }, 45_000);

  it('agents page Open issue scrolls drawer to active-agent section', async () => {
    const { context, page } = await openRoute('/agents');

    await expect.poll(() => page.locator('[data-component="agent-card"]').count(), renderPoll).toBe(1);
    await page.getByText('Open issue').click();

    await expect.poll(() => page.locator('[data-testid="issue-drawer"]').count(), renderPoll).toBe(1);
    await expect.poll(() => page.locator('#active-agent').count(), renderPoll).toBe(1);

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
