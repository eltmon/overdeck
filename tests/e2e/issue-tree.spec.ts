/**
 * The issue tree is the issue workspace (PAN-3917 FR-5 / AC-7).
 *
 * Rows in an issue's tree ARE the terminal backend's panes in that issue's
 * workspace, rendered from their `role`, `harness` and `model` metadata tokens.
 * A reviewer spawned by `pan handoff --issue` carries `role: 'review'`, so it
 * renders as that issue's Review row — never as a loose conversation.
 *
 * Drives the real cockpit route against route mocks; no live server.
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

const renderPoll = { timeout: 20_000, interval: 100 };
const now = '2026-09-18T00:00:00.000Z';
const ISSUE = 'PAN-9101';

const issue = {
  id: ISSUE,
  identifier: ISSUE,
  title: 'Issue tree renders backend panes',
  status: 'In Review',
  state: 'in_review',
  priority: 2,
  labels: [],
  url: `https://example.com/${ISSUE}`,
  createdAt: now,
  updatedAt: now,
  project: { id: 'overdeck', name: 'Overdeck', color: 'var(--primary)' },
};

/**
 * Two panes in the issue workspace. The reviewer was spawned by
 * `pan handoff --issue` — the backend knows it only by its metadata tokens.
 */
const backendPanes = [
  {
    id: 'pane-work-9101',
    issue: ISSUE,
    role: 'work',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    state: 'working',
    terminalId: 'overdeck:pan-9101.0',
    workspace: 'pan-9101',
  },
  {
    id: 'pane-review-9101',
    issue: ISSUE,
    role: 'review',
    harness: 'claude-code',
    model: 'claude-opus-5',
    state: 'working',
    terminalId: 'overdeck:pan-9101.1',
    workspace: 'pan-9101',
  },
];

const snapshot = {
  sequence: 1,
  timestamp: now,
  agents: [],
  specialists: [],
  agentRuntimeById: {},
  // W6 still ships `reviewStatuses` on the wire; it carries nothing now.
  reviewStatuses: [],
  derivedIssueStates: [{
    issueId: ISSUE,
    state: 'in-review',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/9101', number: 9101, reviewState: 'REVIEW_REQUIRED', checks: 'pending', mergeable: true },
    branch: { name: 'feature/pan-9101', aheadOfMain: 4, pushed: true },
  }],
  backendPanes,
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
  await context.addInitScript(({ snapshotFixture, issueId }) => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify({ data: snapshotFixture, timestamp: new Date().toISOString() }));
    window.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
      const path = new URL(url, window.location.origin).pathname;
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

      if (path === '/api/version') return json({ version: 'test', supervisorUrl: null });
      if (path === '/api/dashboard/session') return json({ ok: true });
      if (path === '/api/settings') return json({ tts: { enabled: false } });
      if (path === '/api/tracker-status') return json({ primary: 'github', configured: [] });
      if (path === '/api/registered-projects') return json([{ key: 'overdeck', name: 'Overdeck', path: '/tmp/overdeck' }]);
      // No session-tree rows and no conversations: everything the tree shows
      // must come from the backend pane inventory.
      if (path === '/api/session-trees') return json({ trees: [] });
      if (path === '/api/conversations' || path === '/api/conversations/pending-input') return json([]);
      if (path === '/api/git-activity') return json([]);
      if (path === '/api/conversations/cost' || path === '/api/conversations/cost/by-workspace') return json({ totalCost: 0, entries: [] });
      if (path === '/api/costs/stream') return json({ events: [], byIssue: {}, count: 0 });
      if (path === '/api/activity') return json([]);
      if (path === '/api/decisions') return json([]);
      if (path === '/api/confirmations') return json([]);
      if (path === '/api/issues/resource-allocated') return json([]);
      if (path === `/api/command-deck/activity/${issueId}`) return json({ sections: [] });
      if (path === `/api/issues/${issueId}/pr`) return json(null);
      if (path === `/api/issues/${issueId}/check-runs`) return json({ summary: { total: 0, passed: 0 }, checkRuns: [] });
      if (path === '/api/costs/by-issue') return json({ issues: [] });
      return json({});
    };
  }, { snapshotFixture: snapshot, issueId: ISSUE });
  return context;
}

async function openCockpit(): Promise<{ context: BrowserContext; page: Page; pageErrors: string[] }> {
  const context = await newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/command-deck/overdeck/${ISSUE}`);
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
      name: 'issue-tree-mock-ws-transport',
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
      name: 'issue-tree-empty-index-css',
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

describe('the issue tree is the issue workspace', () => {
  it('renders a Herdr-spawned reviewer as the Review row with its model tag', async () => {
    const { context, page, pageErrors } = await openCockpit();

    const tree = page.locator('[aria-label="Issue tree"]');
    await expect.poll(() => tree.count(), renderPoll).toBe(1);
    await expect.poll(() => tree.innerText(), renderPoll).toMatch(/Review/);

    const rows = (await tree.innerText()).split('\n').map((line) => line.trim());

    // The reviewer pane is the issue's Review row, tagged with the model the
    // backend reported for it — not a loose conversation somewhere else.
    expect(rows.indexOf('Review')).toBeGreaterThan(-1);
    expect(rows.slice(rows.indexOf('Review'))).toContain('opus-5');

    // Its work pane sits alongside it, tagged with its own model.
    expect(rows.indexOf('Work')).toBeGreaterThan(-1);
    expect(rows.slice(rows.indexOf('Work'), rows.indexOf('Review'))).toContain('sonnet-5');

    expect(pageErrors).toEqual([]);
    await context.close();
  }, 60_000);

  it('takes its rows from the pane inventory alone', async () => {
    const { context, page } = await openCockpit();

    const tree = page.locator('[aria-label="Issue tree"]');
    await expect.poll(() => tree.count(), renderPoll).toBe(1);
    await expect.poll(() => tree.innerText(), renderPoll).toMatch(/Review/);
    const rows = (await tree.innerText()).split('\n').map((line) => line.trim());

    // Exactly one Review row: the pane, with no session-tree ghost beside it
    // (/api/session-trees answers empty in this fixture).
    expect(rows.filter((line) => line === 'Review')).toHaveLength(1);

    // Both panes report `working`, and the crew header counts them as such.
    expect(rows).toContain('2 working');

    // The pane id is backend bookkeeping — it never surfaces as a conversation.
    expect(await page.getByText('pane-review-9101', { exact: false }).count()).toBe(0);

    await context.close();
  }, 60_000);
});
