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
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

import { acquireRestartLock, readRestartLockHolder, type RestartLockHandle } from '../../lib/restart-lock.js';
import { writeRestartStatus } from '../../lib/restart-status.js';

import {
  openDashboardLogStdio,
  readPlatformConfig,
  restartDashboard,
  restartCliproxy,
  restartTraefik,
  startTraefik,
  stopTraefik,
  StageError,
  waitForDashboardHealth,
  stopDashboard,
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
}

function resolveScope(options: RestartOptions): 'dashboard' | 'cliproxy' | 'traefik' | 'full' {
  const flags = [
    options.dashboard && 'dashboard',
    options.cliproxy && 'cliproxy',
    options.traefik && 'traefik',
    options.full && 'full',
  ].filter(Boolean) as string[];
  if (flags.length > 1) {
    console.error(chalk.red(`Error: --${flags.join(' and --')} are mutually exclusive`));
    process.exit(2);
  }
  return (flags[0] as any) || 'dashboard';
}

function resolveNode22(): string {
  const nvmNode = '/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node';
  if (existsSync(nvmNode)) return nvmNode;
  return 'node';
}

type DashboardBundleCandidate = {
  path: string;
  preferred: boolean;
};

function dashboardBundleCandidates(): DashboardBundleCandidate[] {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return [
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
  const candidates = uniqueBundleCandidates();
  return candidates.find(candidate => existsSync(candidate.path))?.path
    ?? candidates.find(candidate => candidate.preferred)?.path
    ?? candidates[0].path;
}

function searchedBundlePaths(): string[] {
  return uniqueBundleCandidates().map(candidate => candidate.path);
}

export function spawnDashboardDetached(config: PlatformConfig, opts?: { disableDeacon?: boolean }): void {
  const serverPath = resolveBundledServerPath();
  if (!existsSync(serverPath)) {
    throw new StageError({
      stage: 'dashboard',
      reason: `Dashboard bundle not found. Run \`npm run build\`. Searched: ${searchedBundlePaths().join(', ')}`,
    });
  }
  const child = spawn(resolveNode22(), [serverPath], {
    detached: true,
    stdio: openDashboardLogStdio(),
    env: {
      ...process.env,
      DASHBOARD_PORT: String(config.dashboardPort),
      API_PORT: String(config.dashboardApiPort),
      PORT: String(config.dashboardApiPort),
      PANOPTICON_MODE: 'production',
      ...(opts?.disableDeacon ? { PANOPTICON_DISABLE_DEACON: '1' } : {}),
    },
  });
  child.unref();
}

async function recordRestartStatus(startedAt: number, success: boolean, error?: string): Promise<void> {
  await writeRestartStatus({
    ts: new Date().toISOString(),
    trigger: 'pan restart',
    success,
    error,
    durationMs: Date.now() - startedAt,
    attempts: 1,
  });
}

async function reportHeldRestartLock(startedAt: number): Promise<void> {
  const holder = await readRestartLockHolder();
  const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
  const error = `restart in progress (${heldBy})`;
  console.error(chalk.yellow(error));
  await recordRestartStatus(startedAt, false, error);
  process.exitCode = 2;
}

export async function restartCommand(options: RestartOptions): Promise<void> {
  const startedAt = Date.now();
  const scope = resolveScope(options);
  const config = readPlatformConfig();
  const healthTimeoutMs = options.healthTimeout
    ? parseInt(options.healthTimeout, 10)
    : undefined;

  const disableDeacon = options.deacon === false;
  if (disableDeacon) {
    console.log(chalk.yellow('  Deacon auto-start disabled for this restart (--no-deacon)'));
  }

  console.log(chalk.bold(`Restarting Panopticon (${scope})...\n`));

  const lockInherited = process.env.PANOPTICON_RESTART_LOCK_HELD === '1';
  const needsRestartLock = (scope === 'dashboard' || scope === 'full') && !lockInherited;
  let restartLock: RestartLockHandle | null = null;
  if (needsRestartLock) {
    restartLock = await acquireRestartLock('pan restart');
    if (!restartLock) {
      await reportHeldRestartLock(startedAt);
      return;
    }
  }

  try {
    switch (scope) {
      case 'dashboard': {
        if (process.env.PANOPTICON_SKIP_SUPERVISOR_CYCLE !== '1') {
          try {
            const { stopSupervisorProcess, startSupervisorProcess } = await import('../../lib/supervisor.js');
            stopSupervisorProcess();
            startSupervisorProcess();
          } catch { /* non-fatal */ }
        }

        await restartDashboard(config, () => spawnDashboardDetached(config, { disableDeacon }), {
          healthTimeoutMs,
        });
        await recordRestartStatus(startedAt, true);
        console.log(chalk.green('✓ Dashboard restarted and healthy'));
        console.log(chalk.dim('  CLIProxy, Traefik, and TLDR were left running.'));
        break;
      }
      case 'cliproxy': {
        const cliproxy = await import('../../lib/cliproxy.js');
        await restartCliproxy(cliproxy, { force: options.force === true });
        if (options.force) {
          console.log(chalk.green('✓ CLIProxy reinstalled at pinned version and restarted'));
        } else {
          console.log(chalk.green('✓ CLIProxy restarted'));
        }
        console.log(chalk.dim('  Dashboard and Traefik were left running.'));
        break;
      }
      case 'traefik': {
        await restartTraefik(config);
        console.log(chalk.green('✓ Traefik restarted'));
        console.log(chalk.dim('  Dashboard and CLIProxy were left running.'));
        break;
      }
      case 'full': {
        await runFullRestart(config, { healthTimeoutMs, disableDeacon });
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
  opts: { healthTimeoutMs?: number; disableDeacon?: boolean },
): Promise<void> {
  const projectRoot = process.cwd();
  const venvPath = join(projectRoot, '.venv');
  const tldrAvailable = existsSync(venvPath);

  // ── Stop phase ──
  // Dashboard first so it doesn't spam errors while sidecars die.
  await stopDashboard(config);

  try {
    const { stopSupervisorProcess } = await import('../../lib/supervisor.js');
    stopSupervisorProcess();
  } catch {
    // non-fatal
  }

  if (tldrAvailable) {
    try {
      const { Effect } = await import('effect');
      const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
      const { getTldrDaemonService } = await import('../../lib/tldr-daemon.js');
      await Effect.runPromise(getTldrDaemonService(projectRoot, venvPath).stop().pipe(Effect.provide(NodeServicesLayer)));
    } catch {
      // non-fatal — daemon may already be down
    }
  }

  if (config.traefikEnabled) {
    await stopTraefik(config);
  }

  // ── Start phase ──
  // Traefik first so routes exist before anything binds; CLIProxy before
  // dashboard so GPT-backed agents have their router from t=0; TLDR last
  // because it's non-critical and shouldn't block the dashboard coming up.
  if (config.traefikEnabled) {
    await startTraefik(config);
  }

  // restartCliproxy handles stop-sleep-start-verify in one shot.
  const cliproxy = await import('../../lib/cliproxy.js');
  await restartCliproxy(cliproxy);

  spawnDashboardDetached(config, { disableDeacon: opts.disableDeacon });
  await waitForDashboardHealth(config.dashboardApiPort, {
    timeoutMs: opts.healthTimeoutMs,
  });

  try {
    const { startSupervisorProcess } = await import('../../lib/supervisor.js');
    startSupervisorProcess();
  } catch {
    // non-fatal
  }

  if (tldrAvailable) {
    try {
      const { Effect } = await import('effect');
      const { layer: NodeServicesLayer } = await import('@effect/platform-node/NodeServices');
      const { getTldrDaemonService } = await import('../../lib/tldr-daemon.js');
      await Effect.runPromise(getTldrDaemonService(projectRoot, venvPath).start(true).pipe(Effect.provide(NodeServicesLayer)));
    } catch {
      // non-fatal — dashboard is already healthy; TLDR just won't be available
    }
  }

  console.log(chalk.green('✓ Full stack restarted and healthy'));
}
