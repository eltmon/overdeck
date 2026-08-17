import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireRestartLock: vi.fn(),
  readRestartLockHolder: vi.fn(),
  readPlatformConfigSync: vi.fn(),
  writeRestartStatus: vi.fn(),
  refuseNonPrimaryDashboardCwd: vi.fn(),
  resolveBundledServerPath: vi.fn(),
  spawnDashboardDetached: vi.fn(),
  buildDashboardFromOriginMain: vi.fn(),
  removeDashboardDeployment: vi.fn(),
  runGitAsync: vi.fn(),
  sweepDashboardDeployments: vi.fn(),
  readDevSupervisorMarker: vi.fn(),
  agentRestartBlockReason: vi.fn(),
}));

vi.mock('../../../lib/restart-lock.js', () => ({
  acquireRestartLock: mocks.acquireRestartLock,
  readRestartLockHolder: mocks.readRestartLockHolder,
}));

vi.mock('../../../lib/restart-status.js', () => ({
  writeRestartStatus: mocks.writeRestartStatus,
}));

vi.mock('../../../lib/dev-supervisor.js', () => ({
  readDevSupervisorMarker: mocks.readDevSupervisorMarker,
  devSupervisorRefusalLines: vi.fn(() => []),
}));

vi.mock('../../../lib/deploy/agent-restart-gate.js', () => ({
  agentRestartBlockReason: mocks.agentRestartBlockReason,
}));

vi.mock('../../../lib/deploy/build-from-origin.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/deploy/build-from-origin.js')>()),
  buildDashboardFromOriginMain: mocks.buildDashboardFromOriginMain,
  removeDashboardDeployment: mocks.removeDashboardDeployment,
  runGitAsync: mocks.runGitAsync,
  sweepDashboardDeployments: mocks.sweepDashboardDeployments,
}));

vi.mock('../../../lib/platform-lifecycle.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/platform-lifecycle.js')>()),
  readPlatformConfigSync: mocks.readPlatformConfigSync,
}));

vi.mock('../restart.js', () => ({
  refuseNonPrimaryDashboardCwd: mocks.refuseNonPrimaryDashboardCwd,
  resolveBundledServerPath: mocks.resolveBundledServerPath,
  spawnDashboardDetached: mocks.spawnDashboardDetached,
}));

// The restart-approval gate (PAN-3729) polls the dashboard over HTTP. This test
// stands up its own health server, so let the reload through without a gate.
vi.mock('../../../lib/restart-gate-client.js', () => ({
  restartGateRequesterId: (kind: string) => `${kind}:1234`,
  waitForRestartApproval: vi.fn(async () => ({ proceed: true, reason: 'ungated', detail: 'no gate in tests' })),
}));

import { reloadCommand } from '../reload.js';
import {
  activeDashboardBundleFile,
  readActiveDashboardBundleSync,
} from '../../../lib/deploy/active-dashboard-bundle.js';

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve test port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const originalOverdeckHome = process.env.OVERDECK_HOME;
const originalExitCode = process.exitCode;
let temporaryRoot: string | null = null;
let delayedServer: Server | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.acquireRestartLock.mockReturnValue(Effect.succeed({
    refresh: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }));
  mocks.readRestartLockHolder.mockReturnValue(Effect.succeed(null));
  mocks.writeRestartStatus.mockReturnValue(Effect.succeed(undefined));
  mocks.refuseNonPrimaryDashboardCwd.mockReturnValue(false);
  mocks.resolveBundledServerPath.mockReturnValue('/unused/server.js');
  mocks.readDevSupervisorMarker.mockReturnValue(null);
  mocks.agentRestartBlockReason.mockResolvedValue(null);
  mocks.sweepDashboardDeployments.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await closeServer(delayedServer);
  delayedServer = null;
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = null;
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  process.exitCode = originalExitCode;
});

describe('reloadCommand health-timeout recovery', () => {
  it('keeps the timed-out deployment intact so its delayed dashboard can become healthy', async () => {
    temporaryRoot = await fs.mkdtemp(join(tmpdir(), 'overdeck-reload-timeout-'));
    const repoRoot = join(temporaryRoot, 'repo');
    const overdeckHome = join(temporaryRoot, 'home');
    const deployRoot = join(overdeckHome, 'deployments', 'dashboard', '.pan-reload-generation-a');
    const serverPath = join(deployRoot, 'dist', 'dashboard', 'server.js');
    const apiPort = await reservePort();
    let dashboardPort = await reservePort();
    while (dashboardPort === apiPort) dashboardPort = await reservePort();

    process.env.OVERDECK_HOME = overdeckHome;
    await fs.mkdir(join(repoRoot, 'dist'), { recursive: true });
    await fs.writeFile(join(repoRoot, 'dist', 'previous.js'), 'previous bundle');
    await fs.mkdir(join(deployRoot, 'dist', 'dashboard'), { recursive: true });
    await fs.mkdir(join(deployRoot, 'node_modules'), { recursive: true });
    await fs.writeFile(serverPath, 'canonical bundle');
    // PAN-3172: reload now refuses a generation whose PTY supervisor cannot
    // start there. This stand-in imports nothing the deployment lacks, so the
    // gate passes and the health-timeout path under test still runs.
    await fs.writeFile(
      join(deployRoot, 'dist', 'pty-supervisor.js'),
      'import { join } from "node:path";\nexport { join };\n',
    );

    mocks.readPlatformConfigSync.mockReturnValue({
      dashboardPort,
      dashboardApiPort: apiPort,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: join(temporaryRoot, 'traefik'),
    });
    mocks.runGitAsync.mockResolvedValue({ stdout: `${repoRoot}\n`, stderr: '' });
    mocks.buildDashboardFromOriginMain.mockResolvedValue({ deployRoot, serverPath });
    mocks.removeDashboardDeployment.mockImplementation(async () => {
      await fs.rm(deployRoot, { recursive: true, force: true });
    });

    delayedServer = createServer((request, response) => {
      if (request.url !== '/api/health') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', repoRoot, mode: 'primary' }));
    });
    let resolveListening!: () => void;
    const listening = new Promise<void>((resolve) => { resolveListening = resolve; });
    mocks.spawnDashboardDetached.mockImplementation(() => {
      setTimeout(() => delayedServer?.listen(apiPort, '127.0.0.1', resolveListening), 1500);
      return { stop: vi.fn() };
    });

    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn((input: string | URL | Request, init?: RequestInit) => realFetch(input, init));
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });

    const reload = reloadCommand({ healthTimeout: '1000' });
    while (fetchSpy.mock.calls.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await vi.advanceTimersByTimeAsync(1100);
    await reload;

    expect(process.exitCode).toBe(1);
    expect(mocks.removeDashboardDeployment).not.toHaveBeenCalled();
    expect(readActiveDashboardBundleSync()).toEqual({ repoRoot, deployRoot, serverPath });
    await expect(fs.readFile(serverPath, 'utf8')).resolves.toBe('canonical bundle');
    await expect(fs.readFile(join(repoRoot, 'dist', 'dashboard', 'server.js'), 'utf8'))
      .resolves.toBe('canonical bundle');
    await expect(fs.access(join(repoRoot, `dist.rollback.${process.pid}`)))
      .rejects.toMatchObject({ code: 'ENOENT' });

    await vi.advanceTimersByTimeAsync(500);
    await listening;
    const health = await realFetch(`http://127.0.0.1:${apiPort}/api/health`);
    expect(health.ok).toBe(true);
    await expect(health.json()).resolves.toMatchObject({ repoRoot, mode: 'primary' });
    await expect(fs.readFile(activeDashboardBundleFile(), 'utf8'))
      .resolves.toContain(serverPath);
  });
});
