import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireRestartLock: vi.fn(),
  readRestartLockHolder: vi.fn(),
  readPlatformConfig: vi.fn(),
  restartDashboard: vi.fn(),
  stopDashboard: vi.fn(),
  writeRestartStatus: vi.fn(),
  refuseNonPrimaryDashboardCwd: vi.fn(),
  resolveBundledServerPath: vi.fn(),
  resolvePrimaryDashboardIdentity: vi.fn(),
  spawnDashboardDetached: vi.fn(),
  exec: vi.fn(),
  spawn: vi.fn(),
  statSync: vi.fn(),
  fsAccess: vi.fn(),
  fsReaddir: vi.fn(),
  fsRm: vi.fn(),
  fsCp: vi.fn(),
  fsRename: vi.fn(),
  fsSymlink: vi.fn(),
  readDevSupervisorMarker: vi.fn(),
  devSupervisorRefusalLines: vi.fn(),
  agentRestartBlockReason: vi.fn(),
  readActiveDashboardBundle: vi.fn(),
  writeActiveDashboardBundle: vi.fn(),
  fsMkdir: vi.fn(),
  supervisorDeploymentFailure: vi.fn(),
  dashboardServerBootFailure: vi.fn(),
  waitForRestartApproval: vi.fn(),
}));

// reloadCommand refuses to run when a `pan dev` supervisor marker is present.
// Without mocking this, the test outcome depends on whether the host happens to
// have a live `pan dev` session — green in CI, red on a developer's machine.
// Default to "no dev session" so the test is hermetic.
vi.mock('../../../lib/dev-supervisor.js', () => ({
  readDevSupervisorMarker: mocks.readDevSupervisorMarker,
  devSupervisorRefusalLines: mocks.devSupervisorRefusalLines,
}));

vi.mock('../../../lib/restart-lock.js', () => ({
  acquireRestartLock: mocks.acquireRestartLock,
  readRestartLockHolder: mocks.readRestartLockHolder,
}));

vi.mock('../../../lib/deploy/agent-restart-gate.js', () => ({
  agentRestartBlockReason: mocks.agentRestartBlockReason,
}));

vi.mock('../../../lib/channels/pty-supervisor-locate.js', () => ({
  supervisorDeploymentFailure: mocks.supervisorDeploymentFailure,
}));

vi.mock('../../../lib/deploy/dashboard-bundle-integrity.js', () => ({
  dashboardServerBootFailure: mocks.dashboardServerBootFailure,
}));

vi.mock('../../../lib/deploy/active-dashboard-bundle.js', () => ({
  readActiveDashboardBundleSync: mocks.readActiveDashboardBundle,
  writeActiveDashboardBundle: mocks.writeActiveDashboardBundle,
}));

vi.mock('../../../lib/platform-lifecycle.js', () => ({
  readPlatformConfig: mocks.readPlatformConfig,
  readPlatformConfigSync: mocks.readPlatformConfig,
  restartDashboard: mocks.restartDashboard,
  stopDashboard: mocks.stopDashboard,
  parseHealthTimeoutMs: (value: string | undefined, defaultMs: number) => {
    if (value === undefined || value === '') return defaultMs;
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--health-timeout must be a positive integer, got ${value}`);
    return n;
  },
  StageError: class StageError extends Error {
    failure: { stage: string; reason: string; recovery?: 'dashboard-left-running' };
    constructor(failure: { stage: string; reason: string; recovery?: 'dashboard-left-running' }) {
      super(`[${failure.stage}] ${failure.reason}`);
      this.failure = failure;
    }
  },
  leavesDashboardRunning: (error: unknown) => (
    (error as { failure?: { recovery?: string } })?.failure?.recovery === 'dashboard-left-running'
  ),
}));

vi.mock('../../../lib/restart-status.js', () => ({
  writeRestartStatus: mocks.writeRestartStatus,
}));

// The restart-approval gate (PAN-3729) polls the dashboard over HTTP. Mock it so
// these tests never reach the network and never wait on a real poll interval.
vi.mock('../../../lib/restart-gate-client.js', () => ({
  restartGateRequesterId: (kind: string) => `${kind}:1234`,
  waitForRestartApproval: mocks.waitForRestartApproval,
}));

vi.mock('../restart.js', () => ({
  refuseNonPrimaryDashboardCwd: mocks.refuseNonPrimaryDashboardCwd,
  resolveBundledServerPath: mocks.resolveBundledServerPath,
  resolvePrimaryDashboardIdentity: mocks.resolvePrimaryDashboardIdentity,
  spawnDashboardDetached: mocks.spawnDashboardDetached,
}));

vi.mock('child_process', () => {
  const exec = mocks.exec as typeof mocks.exec & { [promisify.custom]?: unknown };
  exec[promisify.custom] = (command: string, options: { cwd?: string }) => mocks.exec(command, options);
  return {
    exec,
    spawn: mocks.spawn,
  };
});

vi.mock('fs', async (importActual) => ({
  ...(await importActual<typeof import('fs')>()),
  promises: {
    ...(await importActual<typeof import('fs')>()).promises,
    access: mocks.fsAccess,
    readdir: mocks.fsReaddir,
    mkdir: mocks.fsMkdir,
    rm: mocks.fsRm,
    cp: mocks.fsCp,
    rename: mocks.fsRename,
    symlink: mocks.fsSymlink,
  },
  statSync: mocks.statSync,
}));

import { reloadCommand } from '../reload.js';

// reloadCommand spawns `bun install` then `npm run build`. Let tests set each
// step's exit code independently; default both to success.
function mockSpawnExits(opts: { install?: number; build?: number } = {}): void {
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
    const child = new EventEmitter();
    const isBuild = command === 'npm' && args[0] === 'run' && args[1] === 'build';
    const code = isBuild ? (opts.build ?? 0) : (opts.install ?? 0);
    process.nextTick(() => child.emit('close', code));
    return child;
  });
}

function mockExecByCommand(handlers: Record<string, Array<{ stdout?: string; code?: number; stderr?: string }>>): void {
  const remaining = new Map(Object.entries(handlers).map(([command, results]) => [command, [...results]]));
  mocks.exec.mockImplementation(async (command: string) => {
    const queue = remaining.get(command);
    const result = queue?.shift();
    if (!result) {
      throw new Error(`Unexpected exec command: ${command}`);
    }
    if (typeof result.code === 'number' && result.code !== 0) {
      const error = new Error(result.stderr || `Command failed: ${command}`) as Error & { code: number; stderr?: string };
      error.code = result.code;
      error.stderr = result.stderr;
      throw error;
    }
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  });
}

const DEFAULT_REPO_ROOT = '/repo';
const TEST_OVERDECK_HOME = '/overdeck-home';
const DEFAULT_BUILD_WORKTREE = `${TEST_OVERDECK_HOME}/deployments/dashboard/.pan-reload-generation-a`;
const ALTERNATE_BUILD_WORKTREE = `${TEST_OVERDECK_HOME}/deployments/dashboard/.pan-reload-generation-b`;
const DEFAULT_ORIGIN_MAIN_SHA = '1111111111111111111111111111111111111111';

const originalAgentId = process.env.OVERDECK_AGENT_ID;
const originalRestartInitiator = process.env.OVERDECK_RESTART_INITIATOR;
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const originalOverdeckHome = process.env.OVERDECK_HOME;

function restoreEnv(): void {
  if (originalAgentId === undefined) delete process.env.OVERDECK_AGENT_ID;
  else process.env.OVERDECK_AGENT_ID = originalAgentId;
  if (originalRestartInitiator === undefined) delete process.env.OVERDECK_RESTART_INITIATOR;
  else process.env.OVERDECK_RESTART_INITIATOR = originalRestartInitiator;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
}

describe('reloadCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    delete process.env.OVERDECK_AGENT_ID;
    delete process.env.OVERDECK_RESTART_INITIATOR;
    process.env.HOME = '/home/test';
    process.env.PATH = '/usr/bin:/bin';
    process.env.OVERDECK_HOME = TEST_OVERDECK_HOME;
    vi.spyOn(process, 'cwd').mockReturnValue('/repo');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed({
      refresh: vi.fn(() => Promise.resolve()),
      release: vi.fn(() => Promise.resolve()),
    }));
    mocks.readRestartLockHolder.mockReturnValue(Effect.succeed(null));
    mocks.readPlatformConfig.mockReturnValue({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: '/tmp/traefik',
    });
    mocks.restartDashboard.mockReturnValue(Effect.succeed({ ownershipVerified: true, spawnedPid: 1234 }));
    mocks.writeRestartStatus.mockReturnValue(Effect.succeed(undefined));
    mocks.refuseNonPrimaryDashboardCwd.mockReturnValue(false);
    mocks.resolveBundledServerPath.mockReturnValue('/tmp/server.js');
    mocks.resolvePrimaryDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'primary' });
    mocks.readDevSupervisorMarker.mockReturnValue(null);
    mocks.devSupervisorRefusalLines.mockReturnValue([]);
    mocks.agentRestartBlockReason.mockResolvedValue(null);
    mocks.readActiveDashboardBundle.mockReturnValue(null);
    mocks.writeActiveDashboardBundle.mockResolvedValue(undefined);
    mocks.supervisorDeploymentFailure.mockReturnValue(null);
    mocks.dashboardServerBootFailure.mockReturnValue(null);
    mocks.waitForRestartApproval.mockResolvedValue({ proceed: true, reason: 'ungated', detail: 'no gate in tests' });
    mocks.fsAccess.mockImplementation(async (path: string) => {
      if (path === '/usr/bin/bun') return;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    });
    mocks.fsReaddir.mockResolvedValue([]);
    mocks.fsMkdir.mockResolvedValue(undefined);
    mocks.fsRm.mockResolvedValue(undefined);
    mocks.fsCp.mockResolvedValue(undefined);
    mocks.fsRename.mockResolvedValue(undefined);
    mocks.fsSymlink.mockResolvedValue(undefined);
    mockExecByCommand({
      "git 'rev-parse' '--show-toplevel'": [{ stdout: `${DEFAULT_REPO_ROOT}\n` }],
      "git 'fetch' 'origin' 'main'": [{ stdout: '' }],
      "git 'status' '--porcelain'": [{ stdout: '' }],
      "git 'rev-parse' 'HEAD'": [{ stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n` }],
      "git 'rev-parse' 'origin/main'": [{ stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n` }],
      "git 'worktree' 'prune'": [{ stdout: '' }],
      [`git 'worktree' 'add' '--detach' '${DEFAULT_BUILD_WORKTREE}' 'origin/main'`]: [{ stdout: '' }],
      [`git 'worktree' 'remove' '--force' '${DEFAULT_BUILD_WORKTREE}'`]: [{ stdout: '' }],
    });
  });

  afterEach(() => {
    restoreEnv();
    process.exitCode = undefined;
  });

  it('signals a running pan dev supervisor (SIGUSR2) instead of refusing or restarting (PAN-1662)', async () => {
    mocks.readDevSupervisorMarker.mockReturnValue({
      pid: 424242,
      dashboardPort: 3010,
      apiPort: 3011,
      startedAt: '2026-06-07T00:00:00.000Z',
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await reloadCommand({});

    expect(mocks.acquireRestartLock).toHaveBeenCalledWith('pan reload');
    expect(killSpy).toHaveBeenCalledWith(424242, 'SIGUSR2');
    // It signals the dev supervisor to hot-restart in place — it must NOT run a
    // production restart or refuse with a non-zero exit code.
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    killSpy.mockRestore();
  });

  it('refuses to signal pan dev when the restart lock is already held', async () => {
    mocks.readDevSupervisorMarker.mockReturnValue({
      pid: 424242,
      dashboardPort: 3010,
      apiPort: 3011,
      startedAt: '2026-06-07T00:00:00.000Z',
    });
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed(null));
    mocks.readRestartLockHolder.mockReturnValue(
      Effect.succeed({ pid: 777777, caller: 'pan reload', ts: Date.now() }),
    );
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await reloadCommand({});

    expect(killSpy).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('restart in progress') }),
    );
    expect(process.exitCode).toBe(2);

    killSpy.mockRestore();
  });

  it('refuses the detached path when the restart lock is already held', async () => {
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed(null));
    mocks.readRestartLockHolder.mockReturnValue(
      Effect.succeed({ pid: 777777, caller: 'pan reload', ts: Date.now() }),
    );

    await reloadCommand({});

    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('restart in progress') }),
    );
    expect(process.exitCode).toBe(2);
  });

  it('refuses a blocked agent reload before acquiring the restart lock or building', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';
    mocks.agentRestartBlockReason.mockResolvedValue('Restart refused by active deployment gate.');

    await reloadCommand({});

    expect(mocks.agentRestartBlockReason).toHaveBeenCalledWith({
      initiator: 'agent-pan-2772',
      force: false,
    });
    expect(console.error).toHaveBeenCalledWith('Restart refused by active deployment gate.');
    expect(process.exitCode).toBe(1);
    expect(mocks.acquireRestartLock).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
  });

  it('allows --force to proceed through the agent reload gate', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';

    await reloadCommand({ force: true, skipBuild: true });

    expect(mocks.agentRestartBlockReason).toHaveBeenCalledWith({
      initiator: 'agent-pan-2772',
      force: true,
    });
    expect(mocks.acquireRestartLock).toHaveBeenCalledWith('pan reload');
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
  });

  it('skips the agent reload gate when no initiator is present', async () => {
    await reloadCommand({ skipBuild: true });

    expect(mocks.agentRestartBlockReason).not.toHaveBeenCalled();
    expect(mocks.acquireRestartLock).toHaveBeenCalledWith('pan reload');
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
  });

  it('persists the deploy initiator and stopping phase before restarting', async () => {
    process.env.OVERDECK_RESTART_INITIATOR = 'deploy-patrol';

    await reloadCommand({ skipBuild: true });

    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'pan reload',
      success: false,
      phase: 'stopping',
      initiator: 'deploy-patrol',
    }));
    const stoppingCall = mocks.writeRestartStatus.mock.invocationCallOrder[0];
    const restartCall = mocks.restartDashboard.mock.invocationCallOrder[0];
    expect(stoppingCall).toBeLessThan(restartCall);
  });

  it('warns that a proceeding agent reload disconnects live sessions', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';

    await reloadCommand({ skipBuild: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(
      'disconnect every live conversation and terminal until clients reconnect',
    ));
  });

  it('runs bun install before the build, then restartDashboard, on success', async () => {
    mocks.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 });
    mockSpawnExits();

    await reloadCommand({});

    // Deps are installed before the build so a rebase-added runtime dep can't
    // produce a server bundle that boot-crashes (ERR_MODULE_NOT_FOUND).
    expect(mocks.exec).toHaveBeenCalledWith("git 'rev-parse' '--show-toplevel'", expect.objectContaining({ cwd: DEFAULT_REPO_ROOT }));
    expect(mocks.exec).toHaveBeenCalledWith("git 'fetch' 'origin' 'main'", expect.objectContaining({ cwd: DEFAULT_REPO_ROOT }));
    expect(mocks.exec).toHaveBeenCalledWith("git 'worktree' 'prune'", expect.objectContaining({ cwd: DEFAULT_REPO_ROOT }));
    expect(mocks.exec).toHaveBeenCalledWith(
      `git 'worktree' 'add' '--detach' '${DEFAULT_BUILD_WORKTREE}' 'origin/main'`,
      expect.objectContaining({ cwd: DEFAULT_REPO_ROOT }),
    );
    expect(mocks.spawn).toHaveBeenCalledWith('/usr/bin/bun', ['install'], expect.objectContaining({ cwd: DEFAULT_BUILD_WORKTREE, stdio: 'inherit' }));
    expect(mocks.spawn).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: DEFAULT_BUILD_WORKTREE, stdio: 'inherit' }));
    const installOrder = mocks.spawn.mock.calls.findIndex(([c]) => c === '/usr/bin/bun');
    const buildOrder = mocks.spawn.mock.calls.findIndex(([c, a]) => c === 'npm' && a[1] === 'build');
    expect(installOrder).toBeLessThan(buildOrder);
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('qualifies reload success when spawned dashboard ownership was not verified', async () => {
    mocks.restartDashboard.mockReturnValue(Effect.succeed({ ownershipVerified: false, spawnedPid: null }));

    await reloadCommand({ skipBuild: true });

    const messages = vi.mocked(console.log).mock.calls.map(([message]) => String(message));
    expect(messages.some(message => message.includes('ownership unverified'))).toBe(true);
    expect(messages).not.toContain('✓ Dashboard reloaded and healthy');
  });

  // PAN-3172: the HTTP health check stays green when a generation's
  // node_modules cannot resolve @lydell/node-pty, so the reload printed
  // "healthy" while every new conversation died on a supervisor socket timeout.
  it('fails the reload when the built deployment cannot run the PTY supervisor', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    mocks.supervisorDeploymentFailure.mockReturnValue(
      'Deployment cannot resolve @lydell/node-pty from /dist/pty-supervisor.js',
    );
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.supervisorDeploymentFailure).toHaveBeenCalledWith(DEFAULT_BUILD_WORKTREE);
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.exec).toHaveBeenCalledWith(
      `git 'worktree' 'remove' '--force' '${DEFAULT_BUILD_WORKTREE}'`,
      expect.objectContaining({ cwd: DEFAULT_REPO_ROOT }),
    );
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('@lydell/node-pty') }),
    );
    expect(process.exitCode).toBe(1);
  });

  // PAN-3264: the same trap one layer down. A generation whose own externals
  // cannot resolve serves nothing at all — the server dies on
  // ERR_MODULE_NOT_FOUND at boot — so traffic must never move onto it.
  it('fails the reload when the built server bundle cannot resolve its externals', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    mocks.dashboardServerBootFailure.mockReturnValue(
      'Deployment cannot resolve effect from /dist/dashboard/server.js',
    );
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.dashboardServerBootFailure).toHaveBeenCalledWith(`${DEFAULT_BUILD_WORKTREE}/dist/dashboard/server.js`);
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.exec).toHaveBeenCalledWith(
      `git 'worktree' 'remove' '--force' '${DEFAULT_BUILD_WORKTREE}'`,
      expect.objectContaining({ cwd: DEFAULT_REPO_ROOT }),
    );
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('effect') }),
    );
    expect(process.exitCode).toBe(1);
  });

  it('keeps a successful restart green when previous deployment cleanup fails', async () => {
    const previousRoot = `${TEST_OVERDECK_HOME}/deployments/dashboard/.pan-reload-build-previous`;
    mocks.readActiveDashboardBundle.mockReturnValue({
      repoRoot: DEFAULT_REPO_ROOT,
      deployRoot: previousRoot,
      serverPath: `${previousRoot}/dist/dashboard/server.js`,
    });
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    mocks.fsReaddir.mockResolvedValue(['.pan-reload-build-previous']);
    mocks.fsRm.mockImplementation(async (path: string) => {
      if (path === previousRoot) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    mockExecByCommand({
      "git 'rev-parse' '--show-toplevel'": [{ stdout: `${DEFAULT_REPO_ROOT}\n` }],
      "git 'fetch' 'origin' 'main'": [{ stdout: '' }],
      "git 'status' '--porcelain'": [{ stdout: '' }],
      "git 'rev-parse' 'HEAD'": [{ stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n` }],
      "git 'rev-parse' 'origin/main'": [{ stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n` }],
      "git 'worktree' 'prune'": [{ stdout: '' }, { stdout: '' }],
      [`git 'worktree' 'add' '--detach' '${DEFAULT_BUILD_WORKTREE}' 'origin/main'`]: [{ stdout: '' }],
      [`git 'worktree' 'remove' '--force' '${previousRoot}'`]: [{ code: 128 }],
    });
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(process.exitCode).toBeUndefined();
  });

  it('reuses the inactive generation and restores the active generation across repeated restart failures', async () => {
    const activeBundle = {
      repoRoot: DEFAULT_REPO_ROOT,
      deployRoot: DEFAULT_BUILD_WORKTREE,
      serverPath: `${DEFAULT_BUILD_WORKTREE}/dist/dashboard/server.js`,
    };
    let marker = activeBundle;
    mocks.readActiveDashboardBundle.mockImplementation(() => marker);
    mocks.writeActiveDashboardBundle.mockImplementation(async (next: typeof activeBundle | null) => {
      marker = next ?? activeBundle;
    });
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    mocks.exec.mockImplementation(async (command: string) => {
      if (command === "git 'rev-parse' '--show-toplevel'") return { stdout: `${DEFAULT_REPO_ROOT}\n`, stderr: '' };
      if (command === "git 'rev-parse' 'HEAD'" || command === "git 'rev-parse' 'origin/main'") {
        return { stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n`, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    mocks.restartDashboard.mockReturnValue(Effect.fail(new Error('health failed')));
    mockSpawnExits();

    await reloadCommand({});
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await reloadCommand({});

    const addedRoots = mocks.exec.mock.calls
      .map(([command]) => command as string)
      .filter((command) => command.includes("git 'worktree' 'add'"));
    expect(addedRoots).toEqual([
      `git 'worktree' 'add' '--detach' '${ALTERNATE_BUILD_WORKTREE}' 'origin/main'`,
      `git 'worktree' 'add' '--detach' '${ALTERNATE_BUILD_WORKTREE}' 'origin/main'`,
    ]);
    expect(marker).toEqual(activeBundle);
    expect(mocks.fsRm).toHaveBeenCalledWith(ALTERNATE_BUILD_WORKTREE, { recursive: true, force: true });
    expect(mocks.fsRename).toHaveBeenCalledWith(
      `/repo/dist.rollback.${process.pid}`,
      '/repo/dist',
    );
    expect(process.exitCode).toBe(1);
  });

  it('preserves a deployment when the lifecycle leaves its dashboard running after health timeout', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    mocks.restartDashboard.mockReturnValue(Effect.fail(Object.assign(new Error('health timed out'), {
      failure: {
        stage: 'dashboard',
        reason: 'health timed out; dashboard left running',
        recovery: 'dashboard-left-running',
      },
    })));
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.writeActiveDashboardBundle).toHaveBeenCalledTimes(1);
    expect(mocks.writeActiveDashboardBundle).toHaveBeenCalledWith({
      repoRoot: DEFAULT_REPO_ROOT,
      deployRoot: DEFAULT_BUILD_WORKTREE,
      serverPath: `${DEFAULT_BUILD_WORKTREE}/dist/dashboard/server.js`,
    });
    expect(mocks.exec).not.toHaveBeenCalledWith(
      `git 'worktree' 'remove' '--force' '${DEFAULT_BUILD_WORKTREE}'`,
      expect.anything(),
    );
    expect(mocks.fsRename).not.toHaveBeenCalledWith(
      `/repo/dist.rollback.${process.pid}`,
      '/repo/dist',
    );
    expect(mocks.fsRm).toHaveBeenCalledWith(
      `/repo/dist.rollback.${process.pid}`,
      { recursive: true, force: true },
    );
    expect(process.exitCode).toBe(1);
  });

  it('restarts when obsolete primary dist cleanup fails after the new dist is installed', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    let oldDistRemovals = 0;
    mocks.fsRm.mockImplementation(async (path: string) => {
      if (path === `/repo/dist.rollback.${process.pid}` && ++oldDistRemovals === 2) {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      }
    });
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(process.exitCode).toBeUndefined();
  });

  it('falls back to ~/.bun/bin/bun when the inherited PATH does not contain bun', async () => {
    process.env.HOME = '/home/service';
    mocks.fsAccess.mockImplementation(async (path: string) => {
      if (path === '/home/service/.bun/bin/bun') return;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    });
    mocks.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 });
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.fsAccess).toHaveBeenCalledWith('/usr/bin/bun', expect.any(Number));
    expect(mocks.fsAccess).toHaveBeenCalledWith('/bin/bun', expect.any(Number));
    expect(mocks.fsAccess).toHaveBeenCalledWith('/home/service/.bun/bin/bun', expect.any(Number));
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/home/service/.bun/bin/bun',
      ['install'],
      expect.objectContaining({ cwd: DEFAULT_BUILD_WORKTREE, stdio: 'inherit' }),
    );
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a clear error when bun is absent from PATH and ~/.bun/bin', async () => {
    process.env.HOME = '/home/service';
    mocks.fsAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });

    await reloadCommand({});

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining('bun executable not found in PATH or at /home/service/.bun/bin/bun'),
    }));
    expect(process.exitCode).toBe(1);
  });

  it('aborts without building or restarting when bun install fails', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });
    mockSpawnExits({ install: 1 });

    await reloadCommand({});

    expect(mocks.spawn).toHaveBeenCalledWith('/usr/bin/bun', ['install'], expect.objectContaining({ stdio: 'inherit' }));
    expect(mocks.spawn).not.toHaveBeenCalledWith('npm', ['run', 'build'], expect.anything());
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawnDashboardDetached).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does not restart or stop the dashboard when the build fails', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });
    mockSpawnExits({ build: 1 });

    await reloadCommand({});

    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.stopDashboard).not.toHaveBeenCalled();
    expect(mocks.spawnDashboardDetached).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('launches the canonical bundle from its persistent deployment worktree', async () => {
    const repoRoot = '/repo';
    const buildWorktree = DEFAULT_BUILD_WORKTREE;
    const serverPath = `${buildWorktree}/dist/dashboard/server.js`;
    mocks.statSync.mockReturnValue({ mtimeMs: 2000 });
    mockExecByCommand({
      "git 'rev-parse' '--show-toplevel'": [{ stdout: `${repoRoot}\n` }],
      "git 'fetch' 'origin' 'main'": [{ stdout: '' }],
      "git 'status' '--porcelain'": [{ stdout: '' }],
      "git 'rev-parse' 'HEAD'": [{ stdout: '2222222222222222222222222222222222222222\n' }],
      "git 'rev-parse' 'origin/main'": [{ stdout: '0973c8c0973c8c0973c8c0973c8c0973c8c097\n' }],
      "git 'worktree' 'prune'": [{ stdout: '' }],
      [`git 'worktree' 'add' '--detach' '${buildWorktree}' 'origin/main'`]: [{ stdout: '' }],
    });
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.spawn).toHaveBeenCalledWith('/usr/bin/bun', ['install'], expect.objectContaining({ cwd: buildWorktree }));
    expect(mocks.spawn).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: buildWorktree }));
    expect(mocks.fsCp).toHaveBeenCalledWith(`${buildWorktree}/dist`, `${repoRoot}/dist.incoming`, { recursive: true });
    expect(mocks.fsSymlink).toHaveBeenCalledWith(
      `${buildWorktree}/node_modules`,
      `${repoRoot}/dist.incoming/node_modules`,
      'dir',
    );
    expect(mocks.fsRename).not.toHaveBeenCalledWith(
      `${repoRoot}/node_modules`,
      expect.stringContaining('node_modules.old'),
    );
    expect(mocks.writeActiveDashboardBundle).toHaveBeenCalledWith({
      repoRoot,
      deployRoot: buildWorktree,
      serverPath,
    });
    expect(mocks.exec).not.toHaveBeenCalledWith(
      `git 'worktree' 'remove' '--force' '${buildWorktree}'`,
      expect.anything(),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('0973c8c'));
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    const spawnFactory = mocks.restartDashboard.mock.calls[0][1] as () => unknown;
    spawnFactory();
    expect(mocks.spawnDashboardDetached).toHaveBeenCalledWith(expect.anything(), {
      deacon: undefined,
      serverPath,
      repoRoot,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('cleans up the detached worktree and preserves the running server when worktree build fails', async () => {
    const repoRoot = '/repo';
    const buildWorktree = DEFAULT_BUILD_WORKTREE;
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });
    mockExecByCommand({
      "git 'rev-parse' '--show-toplevel'": [{ stdout: `${repoRoot}\n` }],
      "git 'fetch' 'origin' 'main'": [{ stdout: '' }],
      "git 'status' '--porcelain'": [{ stdout: '' }],
      "git 'rev-parse' 'HEAD'": [{ stdout: '2222222222222222222222222222222222222222\n' }],
      "git 'rev-parse' 'origin/main'": [{ stdout: '0973c8c0973c8c0973c8c0973c8c0973c8c097\n' }],
      "git 'worktree' 'prune'": [{ stdout: '' }],
      [`git 'worktree' 'add' '--detach' '${buildWorktree}' 'origin/main'`]: [{ stdout: '' }],
      [`git 'worktree' 'remove' '--force' '${buildWorktree}'`]: [{ stdout: '' }],
    });
    mockSpawnExits({ build: 1 });

    await reloadCommand({});

    expect(mocks.exec).toHaveBeenCalledWith(
      `git 'worktree' 'remove' '--force' '${buildWorktree}'`,
      expect.objectContaining({ cwd: repoRoot }),
    );
    expect(mocks.fsRm).toHaveBeenCalledWith(buildWorktree, { recursive: true, force: true });
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('Build failed') }),
    );
    expect(process.exitCode).toBe(1);
  });

  it('does not restart the dashboard when git fetch fails', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });
    mockExecByCommand({
      "git 'rev-parse' '--show-toplevel'": [{ stdout: '/repo\n' }],
      "git 'fetch' 'origin' 'main'": [{ code: 128, stderr: 'fetch failed' }],
    });

    await reloadCommand({});

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('fetch failed') }),
    );
    expect(process.exitCode).toBe(1);
  });

  it('resolves a workspace cwd to the primary repo root before building and restarting', async () => {
    vi.mocked(process.cwd).mockReturnValue('/repo/workspaces/feature-pan-2095/subdir');
    mocks.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 });
    mockExecByCommand({
      "git 'rev-parse' '--show-toplevel'": [{ stdout: '/repo/workspaces/feature-pan-2095\n' }],
      "git 'fetch' 'origin' 'main'": [{ stdout: '' }],
      "git 'status' '--porcelain'": [{ stdout: '' }],
      "git 'rev-parse' 'HEAD'": [{ stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n` }],
      "git 'rev-parse' 'origin/main'": [{ stdout: `${DEFAULT_ORIGIN_MAIN_SHA}\n` }],
      "git 'worktree' 'prune'": [{ stdout: '' }],
      [`git 'worktree' 'add' '--detach' '${DEFAULT_BUILD_WORKTREE}' 'origin/main'`]: [{ stdout: '' }],
      [`git 'worktree' 'remove' '--force' '${DEFAULT_BUILD_WORKTREE}'`]: [{ stdout: '' }],
    });
    mockSpawnExits();

    await reloadCommand({});

    expect(mocks.exec).toHaveBeenCalledWith(
      "git 'rev-parse' '--show-toplevel'",
      expect.objectContaining({ cwd: '/repo/workspaces/feature-pan-2095/subdir' }),
    );
    expect(mocks.exec).toHaveBeenCalledWith("git 'fetch' 'origin' 'main'", expect.objectContaining({ cwd: '/repo' }));
    expect(mocks.spawn).toHaveBeenCalledWith('/usr/bin/bun', ['install'], expect.objectContaining({ cwd: DEFAULT_BUILD_WORKTREE }));
    expect(mocks.restartDashboard).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ expectedIdentity: { repoRoot: '/repo', mode: 'primary' } }),
    );
  });

  describe('restart-approval gate (PAN-3729)', () => {
    it('builds first, then waits for approval before restarting', async () => {
      mocks.statSync
        .mockReturnValueOnce({ mtimeMs: 1000 })
        .mockReturnValueOnce({ mtimeMs: 2000 });
      mockSpawnExits();

      await reloadCommand({});

      expect(mocks.waitForRestartApproval).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'reload',
        requesterId: 'reload:1234',
      }));
      // The build is ungated; only the restart waits.
      expect(mocks.spawn.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.waitForRestartApproval.mock.invocationCallOrder[0]);
      expect(mocks.waitForRestartApproval.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.restartDashboard.mock.invocationCallOrder[0]);
    });

    it('keeps the freshly built deployment but restarts nothing when another approved restart already ran', async () => {
      mocks.statSync
        .mockReturnValueOnce({ mtimeMs: 1000 })
        .mockReturnValueOnce({ mtimeMs: 2000 });
      mockSpawnExits();
      mocks.waitForRestartApproval.mockResolvedValue({
        proceed: false,
        reason: 'satisfied',
        detail: 'another approved requester already restarted the dashboard',
      });

      await reloadCommand({});

      expect(mocks.restartDashboard).not.toHaveBeenCalled();
      expect(mocks.writeActiveDashboardBundle).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: '/repo' }));
      expect(process.exitCode).toBeUndefined();
      const messages = vi.mocked(console.log).mock.calls.map(([message]) => String(message));
      expect(messages.some(message => message.includes('restarted nothing'))).toBe(true);
    });
  });
});
