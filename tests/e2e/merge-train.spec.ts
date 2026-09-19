/**
 * Merge train renders from forge mergeability (PAN-3917 AC-7).
 *
 * The dashboard stores no merge status. An issue is ready because the forge
 * says so — approved, checks green, `mergeable` true — and the merge train's
 * queue is the server's forge-derived ready set. This spec drives the real
 * Awaiting Merge page against route mocks (no live server) and proves:
 *   - a forge-mergeable issue gets a merge row and a merge button;
 *   - an issue whose PR has red checks and `mergeable: false` gets neither,
 *     and is shown as blocked instead;
 *   - the merge train section lists exactly the forge's queue.
 */
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
  if (specifier === '@overdeck/contracts') return join(projectRoot, 'packages/contracts');
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
  for (const dependency of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
    const packagePath = join(nodeModulesPath, ...dependency.split('/'));
    try {
      await lstat(packagePath);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dependency.startsWith('@')) {
      await mkdir(join(nodeModulesPath, dependency.split('/')[0]!), { recursive: true });
    }
    await symlink(resolvePackageDir(dependency), packagePath, 'dir');
    linkedFrontendPackages.push(packagePath);
  }
}

const renderPoll = { timeout: 15_000, interval: 100 };
const now = '2026-09-18T00:00:00.000Z';

/** The forge says this one is mergeable: approved, green, no conflict. */
const readyIssue = {
  id: 'PAN-9001',
  identifier: 'PAN-9001',
  title: 'Ready to merge',
  status: 'In Review',
  state: 'in_review',
  priority: 2,
  labels: [],
  url: 'https://example.com/PAN-9001',
  createdAt: now,
  updatedAt: now,
  project: { id: 'pan', name: 'Overdeck', color: 'var(--primary)' },
};

/** The forge refuses this one: red checks, not mergeable. */
const blockedIssue = { ...readyIssue, id: 'PAN-9002', identifier: 'PAN-9002', title: 'Checks are red', url: 'https://example.com/PAN-9002' };

const derivedIssueStates = [
  {
    issueId: 'PAN-9001',
    state: 'ready',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/9001', number: 9001, reviewState: 'APPROVED', checks: 'green', mergeable: true },
    branch: { name: 'feature/pan-9001', aheadOfMain: 3, pushed: true },
  },
  {
    issueId: 'PAN-9002',
    state: 'in-review',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/9002', number: 9002, reviewState: 'APPROVED', checks: 'red', mergeable: false },
    branch: { name: 'feature/pan-9002', aheadOfMain: 1, pushed: true },
  },
];

const snapshot = {
  sequence: 1,
  timestamp: now,
  agents: [],
  specialists: [],
  agentRuntimeById: {},
  derivedIssueStates: [],
  backendPanes: [],
  derivedIssueStates,
  backendPanes: [],
  resources: null,
  issues: [readyIssue, blockedIssue],
  channelPermissionRequests: [],
  scanProgress: null,
  enrichStats: null,
  enrichProgressBySessionId: {},
  embedProgressBySessionId: {},
};

/** The server's forge-derived merge queue — only the mergeable issue is in it. */
const queues = [{
  projectKey: 'overdeck',
  projectName: 'Overdeck',
  enabled: true,
  queue: [{
    issueId: 'PAN-9001',
    title: 'Ready to merge',
    branchName: 'feature/pan-9001',
    pr: 9001,
    prUrl: 'https://github.com/eltmon/overdeck/pull/9001',
    mergeOrder: 1,
    conflictsWith: [],
  }],
}];

async function newContext(): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(({ snapshotFixture, queuesFixture }) => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify({ data: snapshotFixture, timestamp: new Date().toISOString() }));
    window.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
      const path = new URL(url, window.location.origin).pathname;
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

      if (path === '/api/merge-train/queues') return json(queuesFixture);
      if (path === '/api/merge-train/generations') return json([]);
      if (path === '/api/merge-train/merge-backend') return json({ available: true, mode: 'gh-cli', detail: 'gh CLI' });
      if (path === '/api/merge-train/config') return json({ auto_pickup_backlog: false, require_uat_before_merge: false, merge_train_enabled: true });
      if (path === '/api/merge-train/auto-merge') return json({ issues: [] });
      if (path === '/api/version') return json({ version: 'test', supervisorUrl: null });
      if (path === '/api/dashboard/session') return json({ ok: true });
      if (path === '/api/settings') return json({ tts: { enabled: false } });
      if (path === '/api/tracker-status') return json({ primary: 'github', configured: [] });
      if (path === '/api/registered-projects') return json([{ key: 'overdeck', name: 'Overdeck', path: '/tmp/overdeck' }]);
      if (path === '/api/conversations' || path === '/api/conversations/pending-input') return json([]);
      if (path === '/api/git-activity') return json([]);
      if (path === '/api/conversations/cost' || path === '/api/conversations/cost/by-workspace') return json({ totalCost: 0, entries: [] });
      if (path === '/api/costs/stream') return json({ events: [], byIssue: {}, count: 0 });
      if (path === '/api/activity') return json([]);
      if (path === '/api/decisions') return json([]);
      if (path === '/api/confirmations') return json([]);
      return json({});
    };
  }, { snapshotFixture: snapshot, queuesFixture: queues });
  return context;
}

async function openAwaitingMerge(): Promise<{ context: BrowserContext; page: Page; pageErrors: string[] }> {
  const context = await newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/awaiting-merge`);
  return { context, page, pageErrors };
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
      name: 'merge-train-mock-ws-transport',
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
          `,
          map: null,
        };
      },
    }, {
      name: 'merge-train-empty-index-css',
      enforce: 'pre',
      transform(_code: string, id: string) {
        return id.endsWith('/src/index.css') ? { code: ':root { --font-display: system-ui, sans-serif; }', map: null } : null;
      },
    }],
    server: { host: '127.0.0.1', port: 0, watch: null },
    logLevel: 'error',
  });
  await vite.listen();
  const address = vite.httpServer?.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
  await Promise.all(linkedFrontendPackages.map((packagePath) => unlink(packagePath)));
  if (linkedFrontendNodeModules) await unlink(join(frontendRoot, 'node_modules'));
});

describe('merge train renders from forge mergeability', () => {
  it('offers the merge only for the issue the forge calls mergeable', async () => {
    const { context, page, pageErrors } = await openAwaitingMerge();

    await expect.poll(() => page.locator('[data-testid="merge-row-PAN-9001"]').count(), renderPoll).toBe(1);
    await expect.poll(() => page.locator('[data-testid="merge-btn-PAN-9001"]').count(), renderPoll).toBe(1);

    // Red checks and mergeable:false — no merge row, no merge button.
    expect(await page.locator('[data-testid="merge-row-PAN-9002"]').count()).toBe(0);
    expect(await page.locator('[data-testid="merge-btn-PAN-9002"]').count()).toBe(0);

    // The PR is the source of truth for the link the operator follows.
    await expect.poll(
      () => page.locator('[data-testid="merge-pr-link-PAN-9001"]').getAttribute('href'),
      renderPoll,
    ).toBe('https://github.com/eltmon/overdeck/pull/9001');

    expect(pageErrors).toEqual([]);
    await context.close();
  }, 60_000);

  it('lists exactly the forge queue in the merge train section', async () => {
    const { context, page } = await openAwaitingMerge();

    await expect.poll(() => page.locator('[data-testid="merge-train-view"]').count(), renderPoll).toBe(1);
    const section = page.locator('[data-testid="merge-train-project-overdeck"]');
    await expect.poll(() => section.count(), renderPoll).toBe(1);
    await expect.poll(() => section.innerText(), renderPoll).toContain('PAN-9001');
    expect(await section.innerText()).not.toContain('PAN-9002');

    await context.close();
  }, 60_000);
});
