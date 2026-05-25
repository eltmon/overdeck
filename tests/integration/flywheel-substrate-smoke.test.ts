import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStats } from '@panctl/contracts';
import { runGhIssueTrailerHook } from '../../sync-sources/hooks/gh-issue-trailer-hook.ts';

const projectRoot = resolve(__dirname, '../..');

let tempDirs: string[] = [];
let previousPanopticonHome: string | undefined;
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

async function makePanopticonHome(): Promise<string> {
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
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
  await writeFile(join(root, 'src', 'wsTransport.ts'), 'export function subscribeFlywheelStatus() { return () => undefined; }\n');
  await writeFile(join(root, 'src', 'FlywheelConversationPane.ts'), 'import React from \'react\'; export function FlywheelConversationPane() { return React.createElement(\'div\', { \'aria-label\': \'Flywheel conversation stub\' }, \'conversation\'); }\n');
  await writeFile(join(root, 'src', 'FlywheelStatePane.ts'), 'import React from \'react\'; export function FlywheelStatePane() { return React.createElement(\'div\'); }\n');
  await writeFile(join(root, 'src', 'FlywheelStatusDetails.ts'), 'import React from \'react\'; export function FlywheelStatusDetails() { return React.createElement(\'div\'); }\n');
  await writeFile(join(root, 'src', 'main.ts'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { FlywheelPage } from '/src/dashboard-frontend/pages/FlywheelPage.tsx';

    createRoot(document.getElementById('root')!).render(React.createElement(FlywheelPage));
  `);

  viteServer = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [root, projectRoot] },
    },
    esbuild: {
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    },
    resolve: {
      preserveSymlinks: true,
      alias: [
        { find: /(^|\/)lib\/wsTransport$/, replacement: join(root, 'src', 'wsTransport.ts') },
        { find: /(^|\/)components\/flywheel\/FlywheelConversationPane$/, replacement: join(root, 'src', 'FlywheelConversationPane.ts') },
        { find: /(^|\/)components\/flywheel\/FlywheelStatePane$/, replacement: join(root, 'src', 'FlywheelStatePane.ts') },
        { find: /(^|\/)components\/flywheel\/FlywheelStatusDetails$/, replacement: join(root, 'src', 'FlywheelStatusDetails.ts') },
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
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.getByRole('tab', { name: 'Stats' }).click({ timeout: 5000 });
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
  if (previousPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = previousPanopticonHome;

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('flywheel substrate bug smoke', () => {
  it('flows hook provenance through poller projection, stats route, and Stats tab', async () => {
    previousPanopticonHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = await makePanopticonHome();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:15:00.000Z'));

    const hookOutput = runGhIssueTrailerHook(payload("gh issue create --title 'Substrate bug' --body 'body text'"), {
      PANOPTICON_HOME: process.env.PANOPTICON_HOME,
      PANOPTICON_AGENT_ID: 'agent-flywheel',
      PANOPTICON_FLYWHEEL_RUN_ID: 'RUN-777',
      PANOPTICON_FLYWHEEL_AGENT_ROLE: 'flywheel',
    });
    const issueBody = extractSingleQuotedBody(updatedCommand(hookOutput));
    expect(issueBody).toContain('Flywheel-Run-Id: RUN-777');
    expect(issueBody).toContain('Flywheel-Filed-By: agent');
    expect(issueBody).toContain('Flywheel-Discovered-In: PAN-1487');

    const { createSubstrateBugPoller } = await import('../../src/dashboard/server/services/substrate-bug-poller.js');
    const { getByIssueId } = await import('../../src/lib/database/flywheel-substrate-bugs-db.js');
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
      getConfig: () => ({ token: 'ghp_test', repos: [{ owner: 'eltmon', repo: 'panopticon-cli', prefix: 'PAN' }] }),
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
