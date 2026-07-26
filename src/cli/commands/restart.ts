import { exitCli } from '../exit.js';
import { Effect } from 'effect';
/**
 * `pan restart` — scoped restart with explicit dependency isolation.
 *
 * Scopes:
 *   pan restart                    (default: --dashboard)
 *   pan restart --dashboard        Restart only the dashboard. Leaves CLIProxy,
 *                                  Traefik, and TLDR untouched. This is the
 *                                  fix for the "restart killed my CLIProxy"
 *                                  failure mode.
 *   pan restart --cliproxy         Restart only CLIProxy.
 *   pan restart --traefik          Restart only Traefik.
 *   pan restart --full             Stop and restart the whole stack.
 *
 * Each stage is health-gated. On failure, the command exits non-zero with a
 * `[stage] reason` message. A failed dashboard restart leaves shared sidecars
 * (CLIProxy, Traefik) running — recovery beats coupling.
 */

import chalk from 'chalk';
import { execFileSync, spawn } from 'child_process';
import { dirname, join, parse, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import {
  isNonPrimaryCheckoutRoot,
  isWorkspaceRepoRoot,
  primaryRootFromLinkedWorktree,
} from '../../dashboard/server/identity.js';

import { acquireRestartLock, readRestartLockHolder, type RestartLockHandle } from '../../lib/restart-lock.js';
import { writeRestartStatus } from '../../lib/restart-status.js';
import { applyBootGateEnv, formatBootGateState, resolveBootGates, type BootGateOptions } from '../../lib/boot-gates.js';
import { agentRestartBlockReason } from '../../lib/deploy/agent-restart-gate.js';
import { readActiveDashboardBundleSync } from '../../lib/deploy/active-dashboard-bundle.js';

import {
  DASHBOARD_LOG_FILE,
  openDashboardLogStdio,
  readPlatformConfigSync,
  restartDashboard,
  restartCliproxy,
  restartTraefik,
  startTraefik,
  stopTraefik,
  StageError,
  waitForDashboardHealth,
  stopDashboard,
  parseHealthTimeoutMs,
  type DashboardSpawnHandle,
  type PlatformConfig,
} from '../../lib/platform-lifecycle.js';

export interface RestartOptions {
  dashboard?: boolean;
  cliproxy?: boolean;
  traefik?: boolean;
  full?: boolean;
  force?: boolean;
  healthTimeout?: string;
  deacon?: boolean;
  resume?: boolean;
  noResume?: boolean;
}

async function resolveScope(options: RestartOptions): Promise<'dashboard' | 'cliproxy' | 'traefik' | 'full'> {
  const flags = [
    options.dashboard && 'dashboard',
    options.cliproxy && 'cliproxy',
    options.traefik && 'traefik',
    options.full && 'full',
  ].filter(Boolean) as string[];
  if (flags.length > 1) {
    console.error(chalk.red(`Error: --${flags.join(' and --')} are mutually exclusive`));
    return exitCli(2);
  }
  return (flags[0] as any) || 'dashboard';
}

export function resolveGitRepoRoot(cwd: string): string | null {
  let candidate = resolve(cwd);
  const filesystemRoot = parse(candidate).root;
  while (true) {
    if (existsSync(join(candidate, '.git'))) return candidate;
    if (candidate === filesystemRoot) return null;
    candidate = dirname(candidate);
  }
}

export function refuseNonPrimaryDashboardCwd(cwd: string, verb: string): boolean {
  if (existsSync('/.dockerenv')) return false;

  const repoRoot = resolveGitRepoRoot(cwd);
  if (!repoRoot) return false;

  const isWorkspace = isWorkspaceRepoRoot(repoRoot);
  if (!isNonPrimaryCheckoutRoot(repoRoot)) return false;

  const primaryRepoRoot = primaryRootFromLinkedWorktree(repoRoot) ??
    (isWorkspace ? dirname(dirname(repoRoot)) : null);
  const primaryGuidance = primaryRepoRoot
    ? ` Run this command from the primary checkout at ${primaryRepoRoot}.`
    : '';
  console.error(chalk.red(
    `Refusing to ${verb} the host dashboard from non-primary checkout ${repoRoot}.${primaryGuidance}`,
  ));
  process.exitCode = 2;
  return true;
}

function resolveNode22(): string {
  // ensureCompatibleNode() relaunches the CLI under a Node >= 22.16 before any
  // command runs, so process.execPath is a guaranteed-compatible, portable Node
  // binary — reuse it rather than re-resolving the old default `node` via PATH.
  return process.execPath;
}

type DashboardBundleCandidate = {
  path: string;
  preferred: boolean;
};

function dashboardBundleCandidates(): DashboardBundleCandidate[] {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return [
    {
      // Code-split CLI chunk living directly in dist/ (tsdown chunk layout can
      // place this module at dist/<chunk>.js — PAN-2820: all relative-parent
      // candidates missed and pan restart stopped the server then failed to
      // respawn it).
      path: join(currentDir, 'dashboard', 'server.js'),
      preferred: currentDir.endsWith(sep + 'dist'),
    },
    {
      path: join(currentDir, '..', 'dashboard', 'server.js'),
      preferred: currentDir.endsWith(join('dist', 'cli')),
    },
    {
      path: join(currentDir, '..', '..', '..', 'dist', 'dashboard', 'server.js'),
      preferred: currentDir.endsWith(join('src', 'cli', 'commands')),
    },
    {
      path: join(currentDir, '..', '..', 'dashboard', 'server.js'),
      preferred: currentDir.endsWith(join('dist', 'cli', 'commands')),
    },
  ];
}

function uniqueBundleCandidates(): DashboardBundleCandidate[] {
  const seen = new Set<string>();
  return dashboardBundleCandidates().filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

export function resolveBundledServerPath(): string {
  const activeBundle = readActiveDashboardBundleSync();
  if (activeBundle) return activeBundle.serverPath;

  const candidates = uniqueBundleCandidates();
  return candidates.find(candidate => existsSync(candidate.path))?.path
    ?? candidates.find(candidate => candidate.preferred)?.path
    ?? candidates[0].path;
}

export function resolvePrimaryDashboardIdentity(): { repoRoot: string; mode: 'primary' } {
  const activeBundle = readActiveDashboardBundleSync();
  return {
    repoRoot: activeBundle?.repoRoot ?? resolve(resolveBundledServerPath(), '..', '..', '..'),
    mode: 'primary',
  };
}

function searchedBundlePaths(): string[] {
  return uniqueBundleCandidates().map(candidate => candidate.path);
}

// PAN-2989: the dashboard server is not an agent — never let it inherit the
// spawner's identity. Deploy-patrol exports OVERDECK_AGENT_ID=deploy-patrol on
// its `pan reload` child (deploy-patrol.ts:76); the restarted server inherited
// it and every record-lock owner string lied. Preserve the inherited identity
// under a dedicated var for the PAN-2322 port-override guard, which
// legitimately needs to know WHO spawned us.
export function scrubAgentIdentityFromDashboardEnv(env: NodeJS.ProcessEnv): void {
  if (env.OVERDECK_AGENT_ID !== undefined) {
    env.OVERDECK_DASHBOARD_SPAWNED_BY = env.OVERDECK_AGENT_ID;
  }
  delete env.OVERDECK_AGENT_ID;
  delete env.OVERDECK_ISSUE_ID;
  delete env.OVERDECK_SESSION_TYPE;
  // An agent-launched restart inherits the launcher's git-guard shim dir on
  // PATH; a dashboard running behind that shim has every `git stash`/`git
  // rebase` it issues rejected (the 2026-07-26 workspaces-route GitError storm).
  if (env.PATH !== undefined) {
    env.PATH = env.PATH.split(':').filter(segment => !segment.endsWith('/git-guard')).join(':');
  }
}

export interface DashboardSpawnOptions extends BootGateOptions {
  readonly serverPath?: string;
  readonly repoRoot?: string;
}

export function spawnDashboardDetached(config: PlatformConfig, opts?: DashboardSpawnOptions): DashboardSpawnHandle {
  const serverPath = opts?.serverPath ?? resolveBundledServerPath();
  if (!existsSync(serverPath)) {
    throw new StageError({
      stage: 'dashboard',
      reason: `Dashboard bundle not found. Run \`npm run build\`. Searched: ${searchedBundlePaths().join(', ')}`,
    });
  }
  const env = applyBootGateEnv({ ...process.env }, opts);
  scrubAgentIdentityFromDashboardEnv(env);
  const traefikEnv = config.traefikEnabled
    ? {
        DASHBOARD_URL: `https://${config.traefikDomain}`,
        OVERDECK_TRAEFIK_ENABLED: '1',
        OVERDECK_TRAEFIK_DOMAIN: config.traefikDomain,
        OVERDECK_TRUSTED_ORIGINS: [process.env.OVERDECK_TRUSTED_ORIGINS, `https://${config.traefikDomain}`].filter(Boolean).join(','),
      }
    : {};
  const fullEnv = {
    ...env,
    ...traefikEnv,
    DASHBOARD_PORT: String(config.dashboardPort),
    API_PORT: String(config.dashboardApiPort),
    PORT: String(config.dashboardApiPort),
    OVERDECK_MODE: 'production',
  };
  const identity = opts?.repoRoot
    ? { repoRoot: resolve(opts.repoRoot), mode: 'primary' as const }
    : resolvePrimaryDashboardIdentity();

  // PAN-2804: a plain detached spawn stays in the INVOKER's cgroup — a
  // watchdog-spawned dashboard dies when overdeck-supervisor.service restarts,
  // and a conversation/flywheel-spawned one dies with that tmux pane's scope.
  // Run the server in its own transient systemd unit (same isolation the
  // shared tmux server gets, PAN-1798) so its lifecycle belongs to nobody.
  const systemdHandle = spawnDashboardSystemdUnit(serverPath, fullEnv, identity.repoRoot);
  if (systemdHandle) return systemdHandle;

  const child = spawn(resolveNode22(), [serverPath], {
    cwd: identity.repoRoot,
    detached: true,
    stdio: openDashboardLogStdio(),
    env: fullEnv,
  });
  child.unref();
  console.warn(
    '[dashboard] WARNING (PAN-2804): could not start the dashboard via systemd-run. ' +
      'It shares the invoking process tree\'s cgroup; restarting that unit/scope will kill it.',
  );
  return {
    stop: () => {
      if (!child.pid) return;
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    },
  };
}

/** Valid systemd --setenv names; skips exported bash functions etc. */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function spawnDashboardSystemdUnit(
  serverPath: string,
  fullEnv: Record<string, string | undefined>,
  repoRoot: string,
): DashboardSpawnHandle | null {
  if (process.platform !== 'linux') return null;
  try {
    mkdirSync(dirname(DASHBOARD_LOG_FILE), { recursive: true });
    const unitName = `overdeck-dashboard-${Date.now()}`;
    const setenvArgs = Object.entries(fullEnv)
      .filter(([k, v]) => v !== undefined && ENV_NAME_RE.test(k))
      .flatMap(([k, v]) => ['--setenv', `${k}=${v}`]);
    execFileSync(
      'systemd-run',
      [
        '--user', '--unit', unitName,
        '--collect', '--quiet',
        // The dashboard is the orchestrator — shed agents before it (PAN-2500).
        '--property=ManagedOOMPreference=avoid',
        `--property=StandardOutput=append:${DASHBOARD_LOG_FILE}`,
        `--property=StandardError=append:${DASHBOARD_LOG_FILE}`,
        // /api/health identity derives repoRoot from the server's cwd; keep it.
        `--property=WorkingDirectory=${repoRoot}`,
        ...setenvArgs,
        resolveNode22(), serverPath,
      ],
      { stdio: 'ignore' },
    );
    return {
      stop: () => {
        const unit = `${unitName}.service`;
        try {
          execFileSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore' });
        } catch (stopError) {
          try {
            execFileSync('systemctl', ['--user', 'is-active', '--quiet', unit], { stdio: 'ignore' });
          } catch {
            return; // The unit already exited and was collected.
          }
          throw stopError;
        }
      },
    };
  } catch {
    return null;
  }
}

async function recordRestartStatus(startedAt: number, success: boolean, error?: string): Promise<void> {
  await Effect.runPromise(writeRestartStatus({
    ts: new Date().toISOString(),
    trigger: 'pan restart',
    success,
    error,
    durationMs: Date.now() - startedAt,
    attempts: 1,
    pid: process.pid,
    initiator: process.env.OVERDECK_AGENT_ID,
    issueId: process.env.OVERDECK_ISSUE_ID,
  }));
}

async function reportHeldRestartLock(startedAt: number): Promise<void> {
  const holder = await Effect.runPromise(readRestartLockHolder());
  const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
  const error = `restart in progress (${heldBy})`;
  console.error(chalk.yellow(error));
  await recordRestartStatus(startedAt, false, error);
  process.exitCode = 2;
}

export async function shouldRunManualSupervisorCycle(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.OVERDECK_SKIP_SUPERVISOR_CYCLE === '1') return false;

  try {
    const { systemdUserAvailable, isSupervisorUnitActive } = await import('../../lib/systemd.js');
    return !(await systemdUserAvailable() && await isSupervisorUnitActive());
  } catch {
    return true;
  }
}

export async function restartCommand(options: RestartOptions): Promise<void> {
  const startedAt = Date.now();
  const scope = await resolveScope(options);
  if ((scope === 'dashboard' || scope === 'full') && refuseNonPrimaryDashboardCwd(process.cwd(), 'restart')) {
    return;
  }
  const config = readPlatformConfigSync();
  let healthTimeoutMs: number | undefined;
  try {
    healthTimeoutMs = options.healthTimeout
      ? parseHealthTimeoutMs(options.healthTimeout, 15_000)
      : undefined;
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`));
    return exitCli(2);
  }

  const bootGates = resolveBootGates(options);
  console.log(chalk.dim(`  Boot gates: ${formatBootGateState(bootGates)}`));

  console.log(chalk.bold(`Restarting Overdeck (${scope})...\n`));

  // Refuse to hijack a running `pan dev` session into detached production mode.
  if (scope === 'dashboard' || scope === 'full') {
    const { readDevSupervisorMarker, devSupervisorRefusalLines } = await import('../../lib/dev-supervisor.js');
    const dev = readDevSupervisorMarker();
    if (dev) {
      for (const line of devSupervisorRefusalLines('restart the dashboard', dev)) {
        console.error(chalk.yellow(line));
      }
      process.exitCode = 2;
      return;
    }
  }

  const lockInherited = process.env.OVERDECK_RESTART_LOCK_HELD === '1';
  const needsRestartLock = (scope === 'dashboard' || scope === 'full') && !lockInherited;
  const restartInitiator = process.env.OVERDECK_AGENT_ID;
  if (needsRestartLock && restartInitiator) {
    const restartBlock = await agentRestartBlockReason({
      initiator: restartInitiator,
      force: options.force === true,
    });
    if (restartBlock) {
      console.error(restartBlock);
      process.exitCode = 1;
      return;
    }
    console.log(chalk.yellow(
      '  This agent-issued restart will disconnect every live conversation and terminal until clients reconnect.',
    ));
  }

  let restartLock: RestartLockHandle | null = null;
  if (needsRestartLock) {
    restartLock = await Effect.runPromise(acquireRestartLock('pan restart'));
    if (!restartLock) {
      await reportHeldRestartLock(startedAt);
      return;
    }
  }

  try {
    switch (scope) {
      case 'dashboard': {
        if (await shouldRunManualSupervisorCycle()) {
          try {
            const { stopSupervisorProcessSync, startSupervisorProcessSync } = await import('../../lib/supervisor.js');
            stopSupervisorProcessSync();
            startSupervisorProcessSync();
          } catch { /* non-fatal */ }
        }

        await Effect.runPromise(restartDashboard(config, () => spawnDashboardDetached(config, options), {
          healthTimeoutMs,
          expectedIdentity: resolvePrimaryDashboardIdentity(),
        }));
        await recordRestartStatus(startedAt, true);
        console.log(chalk.green('✓ Dashboard restarted and healthy'));
        console.log(chalk.dim('  CLIProxy, Traefik, and TLDR were left running.'));
        break;
      }
      case 'cliproxy': {
        const cliproxy = await import('../../lib/cliproxy.js');
        await Effect.runPromise(restartCliproxy({
          stopCliproxy: cliproxy.stopCliproxySync,
          startCliproxy: cliproxy.startCliproxySync,
          isCliproxyRunning: cliproxy.isCliproxyRunningSync,
          installCliproxy: cliproxy.installCliproxySync,
        }, { force: options.force === true }));
        if (options.force) {
          console.log(chalk.green('✓ CLIProxy reinstalled at pinned version and restarted'));
        } else {
          console.log(chalk.green('✓ CLIProxy restarted'));
        }
        console.log(chalk.dim('  Dashboard and Traefik were left running.'));
        break;
      }
      case 'traefik': {
        await Effect.runPromise(restartTraefik(config));
        console.log(chalk.green('✓ Traefik restarted'));
        console.log(chalk.dim('  Dashboard and CLIProxy were left running.'));
        break;
      }
      case 'full': {
        await runFullRestart(config, { healthTimeoutMs, bootGateOptions: options });
        break;
      }
    }
  } catch (err) {
    const message = err instanceof StageError
      ? `[${err.failure.stage}] ${err.failure.reason}`
      : (err as Error)?.message || String(err);
    if (scope === 'dashboard') {
      await recordRestartStatus(startedAt, false, message);
    }
    if (err instanceof StageError) {
      console.error(chalk.red(`✗ ${message}`));
      console.error(
        chalk.dim(
          '  Other components were left in their prior state. ' +
            'Run `pan status` to inspect, or `pan restart --full` to rebuild the stack.',
        ),
      );
    } else {
      console.error(chalk.red('✗ Restart failed:'), message);
    }
    process.exitCode = 1;
  } finally {
    await restartLock?.release();
  }
}

/**
 * Full restart: stop everything, then start everything. Uses the same shared
 * lifecycle primitives so the health-gating is identical to scoped restarts.
 *
 * Covers the same four components that `pan down` + `pan up` cover — dashboard,
 * CLIProxy, Traefik, TLDR — so `pan restart --full` is a true stack rebuild.
 */
async function runFullRestart(
  config: PlatformConfig,
  opts: { healthTimeoutMs?: number; bootGateOptions?: BootGateOptions },
): Promise<void> {
  const projectRoot = process.cwd();
  const venvPath = join(projectRoot, '.venv');
  const tldrAvailable = existsSync(venvPath);

  // ── Stop phase ──
  // Dashboard first so it doesn't spam errors while sidecars die.
  await Effect.runPromise(stopDashboard(config));

  try {
    const { stopSupervisorProcessSync } = await import('../../lib/supervisor.js');
    stopSupervisorProcessSync();
  } catch {
    // non-fatal
  }

  if (tldrAvailable) {
    try {
      const { getTldrDaemonServiceSync } = await import('../../lib/tldr-daemon.js');
      await getTldrDaemonServiceSync(projectRoot, venvPath).stop();
    } catch {
      // non-fatal — daemon may already be down
    }
  }

  if (config.traefikEnabled) {
    await Effect.runPromise(stopTraefik(config));
  }

  // ── Start phase ──
  // Traefik first so routes exist before anything binds; CLIProxy before
  // dashboard so GPT-backed agents have their router from t=0; TLDR last
  // because it's non-critical and shouldn't block the dashboard coming up.
  if (config.traefikEnabled) {
    await Effect.runPromise(startTraefik(config));
  }

  // restartCliproxy handles stop-sleep-start-verify in one shot.
  const cliproxy = await import('../../lib/cliproxy.js');
  await Effect.runPromise(restartCliproxy({
    stopCliproxy: cliproxy.stopCliproxySync,
    startCliproxy: cliproxy.startCliproxySync,
    isCliproxyRunning: cliproxy.isCliproxyRunningSync,
    installCliproxy: cliproxy.installCliproxySync,
  }));

  const spawnedDashboard = spawnDashboardDetached(config, opts.bootGateOptions);
  try {
    await Effect.runPromise(waitForDashboardHealth(config.dashboardApiPort, {
      timeoutMs: opts.healthTimeoutMs,
      expectedIdentity: resolvePrimaryDashboardIdentity(),
    }));
  } catch (error) {
    await spawnedDashboard.stop();
    throw error;
  }

  try {
    const { startSupervisorProcessSync } = await import('../../lib/supervisor.js');
    startSupervisorProcessSync();
  } catch {
    // non-fatal
  }

  if (tldrAvailable) {
    try {
      const { getTldrDaemonServiceSync } = await import('../../lib/tldr-daemon.js');
      await getTldrDaemonServiceSync(projectRoot, venvPath).start(true);
    } catch {
      // non-fatal — dashboard is already healthy; TLDR just won't be available
    }
  }

  console.log(chalk.green('✓ Full stack restarted and healthy'));
}
