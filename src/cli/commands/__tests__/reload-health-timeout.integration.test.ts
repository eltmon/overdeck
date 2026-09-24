import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireRestartLock: vi.fn(),
  readRestartLockHolder: vi.fn(),
  readPlatformConfig: vi.fn(),
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
  repointGlobalCliToDeployment: vi.fn(),
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

vi.mock('../../../lib/deploy/global-cli-link.js', () => ({
  repointGlobalCliToDeployment: mocks.repointGlobalCliToDeployment,
}));

vi.mock('../../../lib/platform-lifecycle.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/platform-lifecycle.js')>()),
  readPlatformConfig: mocks.readPlatformConfig,
}));

// PAN-3899: the pre-restart boot-gate read would be the first fetch this test
// waits on; no old dashboard runs here, so report none.
vi.mock('../../../lib/deploy/running-boot-gates.js', () => ({
  readRunningDashboardBootGates: async () => ({ gates: null, reason: 'no dashboard in this test' }),
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
  readActiveDashboardBundle,
  writeActiveDashboardBundle,
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
const originalPath = process.env.PATH;
const originalExitCode = process.exitCode;
let temporaryRoot: string | null = null;
let delayedServer: Server | null = null;
const children: ChildProcess[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.acquireRestartLock.mockResolvedValue({
    refresh: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  });
  mocks.readRestartLockHolder.mockResolvedValue(null);
  mocks.writeRestartStatus.mockResolvedValue(undefined);
  mocks.refuseNonPrimaryDashboardCwd.mockReturnValue(false);
  mocks.resolveBundledServerPath.mockReturnValue('/unused/server.js');
  mocks.readDevSupervisorMarker.mockReturnValue(null);
  mocks.agentRestartBlockReason.mockResolvedValue(null);
  mocks.sweepDashboardDeployments.mockResolvedValue(undefined);
  mocks.repointGlobalCliToDeployment.mockResolvedValue({ status: 'absent' });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await closeServer(delayedServer);
  delayedServer = null;
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
  process.env.PATH = originalPath;
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

    mocks.readPlatformConfig.mockReturnValue({
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
    expect(readActiveDashboardBundle()).toEqual({ repoRoot, deployRoot, serverPath });
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

type SpawnedServerFate = 'exited' | 'zombie' | 'alive';

/** A real child whose pid stands in for the spawned dashboard server. */
async function spawnedServerPid(fate: SpawnedServerFate): Promise<number> {
  if (fate === 'exited') {
    const child = spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: 'ignore' });
    children.push(child);
    await once(child, 'exit');
    return child.pid!;
  }
  if (fate === 'alive') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(child);
    await once(child, 'spawn');
    return child.pid!;
  }
  // A zombie: `sleep` inherits the exited background shell and never reaps it,
  // so kill(0) still succeeds and only ps's `Z` state shows the server is dead.
  const child = spawn('sh', ['-c', 'sh -c "exit 1" & echo $!; exec sleep 60'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  children.push(child);
  const [chunk] = await once(child.stdout!, 'data') as [Buffer];
  const pid = Number(chunk.toString().trim());
  for (;;) {
    const state = await new Promise<string>((resolve) => {
      execFile('ps', ['-p', String(pid), '-o', 'stat='], (_error, stdout) => resolve(String(stdout).trim()));
    });
    if (state.startsWith('Z')) return pid;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

/** Put a `ps` that always fails first on PATH, as when fork/exec fails under memory pressure. */
async function breakPs(root: string): Promise<void> {
  const binDir = join(root, 'broken-bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(join(binDir, 'ps'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  process.env.PATH = `${binDir}:${originalPath ?? ''}`;
}

describe('reloadCommand when the new dashboard never becomes healthy (PAN-3899)', () => {
  async function setUpTimedOutReload(serverPid: number): Promise<{
    repoRoot: string;
    deployRoot: string;
    serverPath: string;
    previous: { repoRoot: string; deployRoot: string; serverPath: string };
    run: () => Promise<void>;
  }> {
    const root = temporaryRoot!;
    const repoRoot = join(root, 'repo');
    const overdeckHome = join(root, 'home');
    const deployRoot = join(overdeckHome, 'deployments', 'dashboard', '.pan-reload-generation-a');
    const previousRoot = join(overdeckHome, 'deployments', 'dashboard', '.pan-reload-generation-b');
    const serverPath = join(deployRoot, 'dist', 'dashboard', 'server.js');
    const previous = {
      repoRoot,
      deployRoot: previousRoot,
      serverPath: join(previousRoot, 'dist', 'dashboard', 'server.js'),
    };
    const apiPort = await reservePort();
    let dashboardPort = await reservePort();
    while (dashboardPort === apiPort) dashboardPort = await reservePort();

    process.env.OVERDECK_HOME = overdeckHome;
    await fs.mkdir(join(repoRoot, 'dist'), { recursive: true });
    await fs.writeFile(join(repoRoot, 'dist', 'previous.js'), 'previous bundle');
    await fs.mkdir(join(previousRoot, 'dist', 'dashboard'), { recursive: true });
    await fs.writeFile(previous.serverPath, 'previous server');
    await writeActiveDashboardBundle(previous);
    await fs.mkdir(join(deployRoot, 'dist', 'dashboard'), { recursive: true });
    await fs.mkdir(join(deployRoot, 'node_modules'), { recursive: true });
    await fs.writeFile(serverPath, 'canonical bundle');
    await fs.writeFile(
      join(deployRoot, 'dist', 'pty-supervisor.js'),
      'import { join } from "node:path";\nexport { join };\n',
    );

    mocks.readPlatformConfig.mockReturnValue({
      dashboardPort,
      dashboardApiPort: apiPort,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: join(root, 'traefik'),
    });
    mocks.runGitAsync.mockResolvedValue({ stdout: `${repoRoot}\n`, stderr: '' });
    mocks.buildDashboardFromOriginMain.mockResolvedValue({ deployRoot, serverPath });
    mocks.removeDashboardDeployment.mockImplementation(async () => {
      await fs.rm(deployRoot, { recursive: true, force: true });
    });
    // No server ever answers on apiPort: the health wait times out and the
    // reload's fate rests on whether the spawned pid is still alive.
    mocks.spawnDashboardDetached.mockImplementation(() => ({ stop: vi.fn(), pid: async () => serverPid }));

    const run = async (): Promise<void> => {
      const realFetch = globalThis.fetch;
      const fetchSpy = vi.fn((input: string | URL | Request, init?: RequestInit) => realFetch(input, init));
      vi.stubGlobal('fetch', fetchSpy);
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      let settled = false;
      const reload = reloadCommand({ healthTimeout: '1000' }).finally(() => { settled = true; });
      while (fetchSpy.mock.calls.length === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      // The health loop interleaves real I/O (fetch, log reads) with fake
      // sleeps, and the liveness probe runs real kill(0)/ps: step the clock
      // until the reload settles instead of jumping it once.
      while (!settled) {
        await vi.advanceTimersByTimeAsync(100);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await reload;
    };
    return { repoRoot, deployRoot, serverPath, previous, run };
  }

  it.each([
    ['exited', false],
    ['exited', true],
    ['zombie', false],
  ] as const)('rolls back to the previous deployment when the new server is %s (ps broken: %s)', async (fate, psBroken) => {
    temporaryRoot = await fs.mkdtemp(join(tmpdir(), 'overdeck-reload-dead-'));
    const pid = await spawnedServerPid(fate);
    if (psBroken) await breakPs(temporaryRoot);
    const fixture = await setUpTimedOutReload(pid);

    await fixture.run();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`pid ${pid}) exited before it became healthy`),
    );
    expect(readActiveDashboardBundle()).toEqual(fixture.previous);
    await expect(fs.readFile(join(fixture.repoRoot, 'dist', 'previous.js'), 'utf8'))
      .resolves.toBe('previous bundle');
    await expect(fs.access(join(fixture.repoRoot, 'dist', 'dashboard', 'server.js')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(fixture.deployRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mocks.removeDashboardDeployment).toHaveBeenCalledWith(fixture.repoRoot, fixture.deployRoot);
    expect(mocks.repointGlobalCliToDeployment).not.toHaveBeenCalled();
  });

  it.each([false, true])('promotes the timed-out deployment while the new server is alive (ps broken: %s)', async (psBroken) => {
    temporaryRoot = await fs.mkdtemp(join(tmpdir(), 'overdeck-reload-alive-'));
    const pid = await spawnedServerPid('alive');
    if (psBroken) await breakPs(temporaryRoot);
    const fixture = await setUpTimedOutReload(pid);

    await fixture.run();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('LEFT RUNNING for inspection'));
    expect(readActiveDashboardBundle()).toEqual({
      repoRoot: fixture.repoRoot,
      deployRoot: fixture.deployRoot,
      serverPath: fixture.serverPath,
    });
    await expect(fs.readFile(join(fixture.repoRoot, 'dist', 'dashboard', 'server.js'), 'utf8'))
      .resolves.toBe('canonical bundle');
    await expect(fs.readFile(fixture.serverPath, 'utf8')).resolves.toBe('canonical bundle');
    expect(mocks.removeDashboardDeployment).not.toHaveBeenCalled();
    expect(mocks.repointGlobalCliToDeployment).toHaveBeenCalledWith(fixture.deployRoot);
  });
});
