import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStats } from '@overdeck/contracts';
import { runGhIssueTrailerHook } from '../../sync-sources/hooks/gh-issue-trailer-hook.ts';

const projectRoot = resolve(__dirname, '../..');

let tempDirs: string[] = [];
let previousOverdeckHome: string | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let viteServer: { close: () => Promise<void>; httpServer?: { address: () => unknown } } | undefined;

function payload(command: string): string {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

function updatedCommand(result: string): string {
  return JSON.parse(result).hookSpecificOutput.updatedInput.command;
}

function extractSingleQuotedBody(command: string): string {
  const body = command.match(/--body '([\s\S]*)'$/)?.[1];
  if (!body) throw new Error(`No rewritten --body found in command: ${command}`);
  return body.replace(/'"'"'/g, "'");
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

async function makeOverdeckHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'pan-flywheel-substrate-smoke-'));
  tempDirs.push(home);
  await mkdir(join(home, 'agents', 'agent-flywheel'), { recursive: true });
  await writeFile(join(home, 'agents', 'agent-flywheel', 'state.json'), JSON.stringify({ issueId: 'PAN-1487' }), 'utf8');
  return home;
}

async function openFlywheelStatsPage(stats: FlywheelStats): Promise<void> {
  const { createServer } = await import('../../src/dashboard/frontend/node_modules/vite/dist/node/index.js');
  const root = await mkdtemp(join(tmpdir(), 'pan-flywheel-stats-page-'));
  tempDirs.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await symlink(resolve(projectRoot, 'src/dashboard/frontend/src'), join(root, 'src', 'dashboard-frontend'), 'dir');
  await symlink(resolve(projectRoot, 'src/dashboard/frontend/node_modules/react'), join(root, 'node_modules', 'react'), 'dir');
  await symlink(resolve(projectRoot, 'src/dashboard/frontend/node_modules/react-dom'), join(root, 'node_modules', 'react-dom'), 'dir');
  await symlink(resolve(projectRoot, 'node_modules/.bun/scheduler@0.23.2/node_modules/scheduler'), join(root, 'node_modules', 'scheduler'), 'dir');
  await symlink(resolve(projectRoot, 'node_modules/.bun/loose-envify@1.4.0/node_modules/loose-envify'), join(root, 'node_modules', 'loose-envify'), 'dir');
  await symlink(resolve(projectRoot, 'src/dashboard/frontend/node_modules/lucide-react'), join(root, 'node_modules', 'lucide-react'), 'dir');
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
  await writeFile(join(root, 'src', 'wsTransport.ts'), 'export function subscribeFlywheelStatus() { return () => undefined; }\n');
  await writeFile(join(root, 'src', 'reactQuery.ts'), `
    import React, { useEffect, useState } from 'react';

    export class QueryClient {}
    export function QueryClientProvider({ children }: { children: React.ReactNode }) { return React.createElement(React.Fragment, null, children); }
    export function useQuery(options: { queryFn: () => Promise<unknown>; queryKey?: unknown }) {
      const [state, setState] = useState<{ data?: unknown; error?: unknown; pending: boolean }>({ pending: true });
      useEffect(() => {
        let cancelled = false;
        options.queryFn().then(
          (data) => { if (!cancelled) setState({ data, pending: false }); },
          (error) => { if (!cancelled) setState({ error, pending: false }); },
        );
        return () => { cancelled = true; };
      }, [JSON.stringify(options.queryKey)]);
      return { data: state.data, error: state.error, isLoading: state.pending, isPending: state.pending, isError: state.error !== undefined };
    }
    export function useQueryClient() {
      return { cancelQueries: async () => undefined, invalidateQueries: async () => undefined, getQueryData: () => undefined, setQueryData: () => undefined };
    }
    export function useMutation(options: { mutationFn: (input: unknown) => Promise<unknown>; onMutate?: (input: unknown) => unknown; onError?: (error: unknown, input: unknown, context: unknown) => unknown; onSuccess?: (data: unknown) => unknown }) {
      const [isPending, setPending] = useState(false);
      return {
        isPending,
        error: null,
        mutate: (input: unknown, callbacks?: { onSettled?: () => void }) => {
          setPending(true);
          const context = options.onMutate?.(input);
          options.mutationFn(input).then(
            (data) => { options.onSuccess?.(data); },
            (error) => { options.onError?.(error, input, context); },
          ).finally(() => { setPending(false); callbacks?.onSettled?.(); });
        },
      };
    }
  `);
  await writeFile(join(root, 'src', 'FlywheelConversationPane.ts'), 'import React from \'react\'; export function FlywheelConversationPane() { return React.createElement(\'div\', { \'aria-label\': \'Flywheel conversation stub\' }, \'conversation\'); }\n');
  await writeFile(join(root, 'src', 'FlywheelStatePane.ts'), 'import React from \'react\'; export function FlywheelStatePane() { return React.createElement(\'div\'); }\n');
  await writeFile(join(root, 'src', 'FlywheelStatusDetails.ts'), 'import React from \'react\'; export function FlywheelStatusDetails() { return React.createElement(\'div\'); }\n');
  await writeFile(join(root, 'src', 'MergeQueueCard.ts'), 'import React from \'react\'; export function MergeQueueCard() { return React.createElement(\'div\'); }\n');
  await writeFile(join(root, 'src', 'MergePolicySection.ts'), 'import React from \'react\'; export function MergePolicySection() { return React.createElement(\'div\'); }\n');
  await writeFile(join(root, 'src', 'scheduler.ts'), `
    export const unstable_ImmediatePriority = 1;
    export const unstable_UserBlockingPriority = 2;
    export const unstable_NormalPriority = 3;
    export const unstable_LowPriority = 4;
    export const unstable_IdlePriority = 5;
    export function unstable_now() { return Date.now(); }
    export function unstable_scheduleCallback(_priority: number, callback: () => void) {
      const id = setTimeout(callback, 0);
      return { id };
    }
    export function unstable_cancelCallback(task: { id?: ReturnType<typeof setTimeout> } | null) {
      if (task?.id !== undefined) clearTimeout(task.id);
    }
    export function unstable_shouldYield() { return false; }
    export function unstable_requestPaint() {}
    export function unstable_getCurrentPriorityLevel() { return unstable_NormalPriority; }
    export function unstable_runWithPriority(_priority: number, callback: () => unknown) { return callback(); }
    export function unstable_next(callback: () => unknown) { return callback(); }
    export function unstable_wrapCallback(callback: () => unknown) { return callback; }
    export function unstable_continueExecution() {}
    export function unstable_pauseExecution() {}
    export function unstable_getFirstCallbackNode() { return null; }
    export function unstable_forceFrameRate() {}
  `);
  await writeFile(join(root, 'src', 'main.ts'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { FlywheelPage } from '/src/dashboard-frontend/pages/FlywheelPage.tsx';

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    createRoot(document.getElementById('root')!).render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(FlywheelPage)),
    );
  `);

  viteServer = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [root, projectRoot] },
      watch: null,
    },
    esbuild: {
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    },
    optimizeDeps: {
      force: true,
      include: ['react', 'react-dom/client', 'scheduler'],
    },
    resolve: {
      preserveSymlinks: true,
      alias: [
        { find: 'scheduler', replacement: join(root, 'src', 'scheduler.ts') },
        { find: '@tanstack/react-query', replacement: join(root, 'src', 'reactQuery.ts') },
        { find: /(^|\/)lib\/wsTransport$/, replacement: join(root, 'src', 'wsTransport.ts') },
        { find: /(^|\/)components\/flywheel\/FlywheelConversationPane$/, replacement: join(root, 'src', 'FlywheelConversationPane.ts') },
        { find: /(^|\/)components\/flywheel\/FlywheelStatePane$/, replacement: join(root, 'src', 'FlywheelStatePane.ts') },
        { find: /(^|\/)components\/flywheel\/FlywheelStatusDetails$/, replacement: join(root, 'src', 'FlywheelStatusDetails.ts') },
        { find: /(^|\/)components\/flywheel\/MergeQueueCard$/, replacement: join(root, 'src', 'MergeQueueCard.ts') },
        { find: /(^|\/)components\/MergePolicySection$/, replacement: join(root, 'src', 'MergePolicySection.ts') },
      ],
    },
    plugins: [{
      name: 'flywheel-smoke-resolve',
      enforce: 'pre',
      resolveId(id) {
        if (id.endsWith('/lib/wsTransport') || id === '../lib/wsTransport') return join(root, 'src', 'wsTransport.ts');
        if (id.endsWith('/components/flywheel/FlywheelConversationPane') || id === '../components/flywheel/FlywheelConversationPane') return join(root, 'src', 'FlywheelConversationPane.ts');
        if (id.endsWith('/components/flywheel/FlywheelStatePane') || id === '../components/flywheel/FlywheelStatePane') return join(root, 'src', 'FlywheelStatePane.ts');
        if (id.endsWith('/components/flywheel/FlywheelStatusDetails') || id === '../components/flywheel/FlywheelStatusDetails') return join(root, 'src', 'FlywheelStatusDetails.ts');
        if (id.endsWith('/components/flywheel/MergeQueueCard') || id === '../components/flywheel/MergeQueueCard') return join(root, 'src', 'MergeQueueCard.ts');
        if (id.endsWith('/components/MergePolicySection') || id === '../components/MergePolicySection') return join(root, 'src', 'MergePolicySection.ts');
        return null;
      },
      transform(code, id) {
        if (!id.includes('/src/dashboard-frontend/') || !id.endsWith('.tsx')) return null;
        let next = code;
        if (id.endsWith('/pages/FlywheelPage.tsx')) {
          next = next
            .replace("../components/flywheel/FlywheelConversationPane", "/src/FlywheelConversationPane.ts")
            .replace("../components/flywheel/FlywheelStatePane", "/src/FlywheelStatePane.ts")
            .replace("../components/flywheel/FlywheelStatusDetails", "/src/FlywheelStatusDetails.ts")
            .replace("../components/flywheel/MergeQueueCard", "/src/MergeQueueCard.ts")
            .replace("../components/MergePolicySection", "/src/MergePolicySection.ts")
            .replace("../lib/wsTransport", "/src/wsTransport.ts");
        }
        if (!next.includes('import React')) {
          next = next.match(/import\s+\{[^}]+\}\s+from ['"]react['"];?/)
            ? next.replace(/import\s+\{/, 'import React, {')
            : `import React from 'react';\n${next}`;
        }
        return next;
      },
    }, {
      name: 'flywheel-smoke-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/api/flywheel/stats')) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(stats));
            return;
          }
          if (req.url?.startsWith('/api/flywheel/current')) {
            res.setHeader('content-type', 'application/json');
            res.end('null');
            return;
          }
          if (req.url?.startsWith('/api/flywheel/config')) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ auto_pickup_backlog: false, require_uat_before_merge: true }));
            return;
          }
          if (req.url?.startsWith('/api/flywheel/auto-merge/pending')) {
            res.setHeader('content-type', 'application/json');
            res.end('[]');
            return;
          }
          next();
        });
      },
    }],
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite server did not expose a TCP address');

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  page = await context.newPage();
  const browserErrors: string[] = [];
  const responseErrors: Promise<void>[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      responseErrors.push(response.text()
        .then((body) => browserErrors.push(`${response.status()} ${response.url()} ${body.slice(0, 500)}`))
        .catch(() => browserErrors.push(`${response.status()} ${response.url()}`)));
    }
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  try {
    await page.getByRole('tab', { name: 'Stats' }).click({ timeout: 5000 });
  } catch (error) {
    await Promise.all(responseErrors);
    const bodyText = await page.locator('body').textContent().catch(() => '');
    throw new Error(`Stats tab did not render. Browser errors: ${browserErrors.join('\n') || 'none'}. Body: ${bodyText}`, { cause: error });
  }
}

afterEach(async () => {
  vi.useRealTimers();
  await context?.close();
  await browser?.close();
  await viteServer?.close();
  context = undefined;
  browser = undefined;
  page = undefined;
  viteServer = undefined;

  const { resetDatabase } = await import('../../src/lib/database/index.js');
  resetDatabase();
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('flywheel substrate bug smoke', () => {
  it('flows hook provenance through poller projection, stats route, and Stats tab', async () => {
    previousOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = await makeOverdeckHome();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:15:00.000Z'));

    const hookOutput = runGhIssueTrailerHook(payload("gh issue create --title 'Substrate bug' --body 'body text'"), {
      OVERDECK_HOME: process.env.OVERDECK_HOME,
      OVERDECK_AGENT_ID: 'agent-flywheel',
      OVERDECK_FLYWHEEL_RUN_ID: 'RUN-777',
      OVERDECK_FLYWHEEL_AGENT_ROLE: 'flywheel',
    });
    const issueBody = extractSingleQuotedBody(updatedCommand(hookOutput));
    expect(issueBody).toContain('Flywheel-Run-Id: RUN-777');
    expect(issueBody).toContain('Flywheel-Filed-By: agent');
    expect(issueBody).toContain('Flywheel-Discovered-In: PAN-1487');

    const { createSubstrateBugPoller } = await import('../../src/dashboard/server/services/substrate-bug-poller.js');
    const { getByIssueId } = await import('../../src/lib/overdeck/flywheel-substrate-bugs.js');
    const eventStore = { appendAsync: vi.fn(async () => 1) };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw);
      const query = url.searchParams.get('q') ?? '';
      if (url.pathname === '/search/issues' && query.includes('is:issue')) {
        return response({
          items: query.includes('author:panopticon-agent[bot]')
            ? [{
              number: 2001,
              title: 'Substrate bug',
              body: issueBody,
              created_at: '2026-05-25T12:10:00.000Z',
              updated_at: '2026-05-25T12:10:00.000Z',
              labels: [{ name: 'substrate' }, { name: 'P1' }],
              user: { login: 'panopticon-agent[bot]' },
            }]
            : [],
        });
      }
      if (url.pathname === '/search/issues' && query.includes('is:pr')) return response({ items: [] });
      return response({ items: [] });
    }) as unknown as typeof fetch;
    const poller = createSubstrateBugPoller({
      intervalMs: 60_000,
      fetchImpl,
      eventStore: eventStore as never,
      getConfig: () => ({ token: 'ghp_test', repos: [{ owner: 'eltmon', repo: 'overdeck', prefix: 'PAN' }] }),
      now: () => new Date('2026-05-25T12:15:00.000Z'),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();

    expect(getByIssueId('PAN-2001')).toMatchObject({
      issueId: 'PAN-2001',
      runId: 'RUN-777',
      filedBy: 'agent',
      discoveredInIssueId: 'PAN-1487',
      severity: 'P1',
      status: 'open',
    });
    expect(eventStore.appendAsync).toHaveBeenCalledWith(expect.objectContaining({
      type: 'substrate.bug_filed',
      payload: expect.objectContaining({ issueId: 'PAN-2001', runId: 'RUN-777', filedBy: 'agent' }),
    }));

    const { computeFlywheelStats } = await import('../../src/dashboard/server/services/flywheel-telemetry.js');
    const { getFlywheelStatsPayload } = await import('../../src/dashboard/server/routes/flywheel.js');
    const statsResult = await getFlywheelStatsPayload('30d', {
      compute: (window) => computeFlywheelStats(window, {
        generatedAt: new Date('2026-05-25T12:15:00.000Z'),
        completedPipelineRuns: 100,
      }),
    });
    expect(statsResult.status).toBe(200);
    const stats = statsResult.body as FlywheelStats;
    expect(stats.criteria.c1_bugRate).toMatchObject({
      label: 'Substrate-bug discovery rate',
      value: 0.01,
      sampleSize: 100,
      status: 'green',
      dataSufficient: true,
    });

    vi.useRealTimers();
    await openFlywheelStatsPage(stats);
    const card = page!.getByRole('region', { name: 'Substrate-bug discovery rate metric' });
    await card.waitFor();
    await expect(card.textContent()).resolves.toContain('1.0%');
  }, 30_000);
});
